import { Kafka, Producer } from "kafkajs";
import http from "http";
import dotenv from "dotenv";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { body, param, validationResult } from "express-validator";
import timeout from "connect-timeout";
import logger from './logger';

import { config } from "./config";
import {
  connectToMongoDB,
  getAllProjects,
  getAllElementsForProject,
  getCostDb,
  getProjectsCollection,
  getElementsCollection,
  getKennwerteCollection,
  getCostElementsCollection,
} from "./mongodb";

import { ElementsResponse, Kennwerte } from "./types";

dotenv.config();

const app = express();
const producer: Producer = new Kafka({
  clientId: "plugin-cost-http",
  brokers: [config.kafka.broker],
}).producer();

let costProducerConnected = false;

// --- Security Middleware ---
// Add helmet for security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // Disable for API
}));

// Add request timeout handling (30 seconds)
app.use(timeout('30s'));

// --- CORS Configuration ---
// Apply CORS before rate limiting to ensure CORS headers are always sent
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:4004").split(",").filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// --- Rate Limiting ---
// Default rate limiter - 100 requests per 15 minutes per IP
const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for health checks
  skip: (req) => req.path === '/health',
});

// Strict rate limiter for write operations - 20 requests per 15 minutes per IP
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: "Too many write requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply default rate limiting to all routes
app.use(defaultLimiter);

// Parse JSON bodies
app.use(express.json({ limit: "1mb" }));

// --- Input Validation Middleware ---
const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// --- Error Handling for Timeouts ---
const haltOnTimedout = (req: Request, res: Response, next: NextFunction) => {
  if (!(req as any).timedout) next();
};

// --- Helper Functions ---
const unitCostsByEbkph: Record<string, number> = {};
async function loadUnitCostsFromDatabase(): Promise<void> {
  try {
    await connectToMongoDB();
    const costDb = await getCostDb();
    const collection = costDb.collection("unit_cost");
    const docs = await collection.find({}).toArray();
    docs.forEach((doc) => {
      unitCostsByEbkph[doc.ebkph] = doc.unit_cost;
    });
    logger.info(`Loaded ${Object.keys(unitCostsByEbkph).length} unit costs from DB.`);
  } catch (error) {
    logger.error("Error loading unit costs from database:", error);
  }
}

// --- API Routes ---
app.get("/projects", haltOnTimedout, async (req: Request, res: Response) => {
  try {
    const projects = await getAllProjects();
    res.status(200).json(projects);
  } catch (error) {
    logger.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to get projects" });
  }
});

app.get("/project-elements/:projectName", 
  param('projectName').trim().notEmpty().withMessage('Project name is required'),
  handleValidationErrors,
  haltOnTimedout,
  async (req: Request, res: Response) => {
    const { projectName } = req.params;
    try {
      const elements = await getAllElementsForProject(projectName);
      
      // Get the actual project metadata from QTO database
      const projectsCollection = await getProjectsCollection();
      const project = await projectsCollection.findOne({
        name: { $regex: new RegExp(`^${projectName}$`, "i") }
      });
      
      // Extract metadata from the project document
      let modelMetadata = {
        filename: `${projectName}.ifc`,
        element_count: elements.length,
        upload_timestamp: new Date().toISOString(),
        project_id: null as string | null
      };
      
      if (project && project.metadata) {
        modelMetadata = {
          filename: project.metadata.filename || `${projectName}.ifc`,
          element_count: elements.length,
          upload_timestamp: project.metadata.upload_timestamp || (project.created_at ? project.created_at.toISOString() : new Date().toISOString()),
          project_id: project._id.toString()
        };
        logger.info(`Project metadata for ${projectName}:`, {
          filename: modelMetadata.filename,
          upload_timestamp: modelMetadata.upload_timestamp,
          project_id: modelMetadata.project_id,
          raw_metadata: project.metadata
        });
      }
      
      const response: ElementsResponse = {
        elements,
        modelMetadata
      };
      
      res.status(200).json(response);
    } catch (error) {
      logger.error(`Error fetching elements for project ${projectName}:`, error);
      res.status(500).json({ error: "Failed to fetch project elements" });
    }
  }
);

app.get("/available-ebkp-codes", haltOnTimedout, (req: Request, res: Response) => {
  const codes = Object.keys(unitCostsByEbkph);
  res.status(200).json({ codes, count: codes.length });
});

app.get("/get-kennwerte/:projectName", 
  param('projectName').trim().notEmpty().withMessage('Project name is required'),
  handleValidationErrors,
  haltOnTimedout,
  async (req: Request, res: Response) => {
    const { projectName } = req.params;
    try {
      const kennwerteCollection = await getKennwerteCollection();
      const kennwerte = await kennwerteCollection.findOne({
        project: projectName,
      });
      res.status(200).json({ kennwerte: kennwerte?.kennwerte || {} });
    } catch (error) {
      logger.error("Error fetching kennwerte:", error);
      res.status(500).json({ error: "Failed to fetch kennwerte" });
    }
  }
);

app.post("/save-kennwerte", 
  strictLimiter, // Apply strict rate limiting for write operations
  body('projectName').trim().notEmpty().withMessage('Project name is required'),
  body('kennwerte').isObject().withMessage('Kennwerte must be an object'),
  handleValidationErrors,
  haltOnTimedout,
  async (req: Request, res: Response) => {
    const { projectName, kennwerte } = req.body;
    
    logger.info(`Saving kennwerte for project: ${projectName}, kennwerte count: ${Object.keys(kennwerte).length}`);
    
    try {
      const kennwerteCollection = await getKennwerteCollection();
      const result = await kennwerteCollection.replaceOne(
        { project: projectName },
        { project: projectName, kennwerte, timestamp: new Date().toISOString() },
        { upsert: true }
      );
      
      logger.info(`Kennwerte save result: matched=${result.matchedCount}, modified=${result.modifiedCount}, upserted=${result.upsertedCount}`);
      
      // Update the in-memory cache
      Object.assign(unitCostsByEbkph, kennwerte);
      
      res.status(200).json({ message: "Kennwerte saved successfully" });
    } catch (error) {
      logger.error("Error saving kennwerte:", error);
      res.status(500).json({ error: "Failed to save kennwerte" });
    }
  }
);

app.post("/reapply-costs", 
  strictLimiter,
  body('projectName').trim().notEmpty().withMessage('Project name is required'),
  handleValidationErrors,
  haltOnTimedout,
  async (req: Request, res: Response) => {
    const { projectName } = req.body;
    logger.info(`Re-applying costs for project: ${projectName}`);
    // In a real scenario, this would trigger a background job
    res.status(200).json({ message: "Cost re-application process initiated" });
  }
);

interface KafkaMessageData {
  id: string;
  [key: string]: any;
}

interface KafkaMessageBody {
  data: KafkaMessageData[];
  project?: string;
  [key: string]: any;
}

app.post("/confirm-costs", 
  strictLimiter,
  body('data').isArray().withMessage('Data must be an array'),
  body('data.*.id').notEmpty().withMessage('Each element must have an id'),
  body('project').optional().trim().notEmpty(),
  handleValidationErrors,
  haltOnTimedout,
  async (req: Request<{}, {}, KafkaMessageBody>, res: Response) => {
    const kafkaMessage = req.body;
    
    try {
      // Send to Kafka
      await producer.send({
        topic: config.kafka.costTopic,
        messages: [
          {
            key: kafkaMessage.project || "unknown",
            value: JSON.stringify(kafkaMessage),
          },
        ],
      });
      
      logger.info(`Sent ${kafkaMessage.data.length} cost elements to Kafka for project ${kafkaMessage.project}`);
      
      res.status(200).json({
        status: "success",
        message: `Successfully sent ${kafkaMessage.data.length} cost elements`,
        count: kafkaMessage.data.length
      });
    } catch (error) {
      logger.error("Error sending cost data to Kafka:", error);
      res.status(500).json({ 
        status: "error",
        error: "Failed to send cost data to Kafka" 
      });
    }
  }
);

// --- Health Check ---
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "UP",
    kafkaProducer: costProducerConnected ? "CONNECTED" : "DISCONNECTED",
    timestamp: new Date().toISOString(),
  });
});

// --- 404 Handler ---
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// --- Global Error Handler ---
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err.code === 'EBADCSRFTOKEN') {
    res.status(403).json({ error: 'Invalid CSRF token' });
  } else if (err.message === 'Not allowed by CORS') {
    res.status(403).json({ error: 'CORS policy violation' });
  } else if ((req as any).timedout) {
    res.status(503).json({ error: 'Request timeout' });
  } else {
    logger.error('Unhandled error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

const server = http.createServer(app);

async function run(): Promise<void> {
  await connectToMongoDB();
  await loadUnitCostsFromDatabase(); // Load costs on startup
  logger.info("MongoDB connected.");
  
  await producer.connect();
  costProducerConnected = true;
  logger.info("Kafka Producer connected.");

  producer.on(producer.events.DISCONNECT, () => {
      costProducerConnected = false;
    logger.info("Kafka Producer disconnected.");
  });

  server.listen(config.server.port, () => {
    logger.info(`HTTP server listening on port ${config.server.port}`);
  });
}

run().catch((error) => {
  logger.error("Failed to start server:", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  server.close(() => {
    producer.disconnect().then(() => process.exit(0));
  });
}); 