/* eslint-disable */
const { Kafka } = require("kafkajs");
const http = require("http");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { body, param, validationResult } = require("express-validator");
const timeout = require("connect-timeout");
const {
  connectToMongoDB,
  getAllProjects,
  getAllElementsForProject,
  getCostDb,
} = require("./mongodb");

dotenv.config();

const config = {
  kafka: {
    broker: process.env.KAFKA_BROKER || "broker:29092",
    costTopic: process.env.KAFKA_COST_TOPIC || "cost-data",
  },
  server: {
    port: parseInt(process.env.HTTP_PORT || "8001"),
  },
};

const app = express();
const producer = new Kafka({
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

// --- Rate Limiting ---
// Default rate limiter - 100 requests per 15 minutes per IP
const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
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

// --- CORS Configuration ---
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

// --- Input Validation Middleware ---
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// --- Error Handling for Timeouts ---
const haltOnTimedout = (req, res, next) => {
  if (!req.timedout) next();
};

// --- Helper Functions ---
const unitCostsByEbkph = {};
async function loadUnitCostsFromDatabase() {
  try {
    await connectToMongoDB();
    const db = getCostDb();
    
    // Load all kennwerte from the database
    const kennwerteCollection = db.collection("kennwerte");
    const allKennwerte = await kennwerteCollection.find({}).toArray();
    
    // Clear existing data
    Object.keys(unitCostsByEbkph).forEach(key => delete unitCostsByEbkph[key]);
    
    // Populate unitCostsByEbkph from all projects
    allKennwerte.forEach(doc => {
      if (doc.kennwerte) {
        Object.assign(unitCostsByEbkph, doc.kennwerte);
      }
    });
    
    console.log(`Loaded ${Object.keys(unitCostsByEbkph).length} unit costs from DB.`);
      } catch (error) {
    console.error("Error loading unit costs from database:", error);
  }
}

// --- API Routes ---
app.get("/projects", haltOnTimedout, async (req, res) => {
  try {
    const projects = await getAllProjects();
    res.status(200).json(projects);
  } catch (error) {
    console.error("Error fetching projects:", error);
    res.status(500).json({ error: "Failed to get projects" });
  }
});

app.get("/project-elements/:projectName", 
  param('projectName').trim().notEmpty().withMessage('Project name is required'),
  handleValidationErrors,
  haltOnTimedout,
  async (req, res) => {
    const { projectName } = req.params;
    try {
      const elements = await getAllElementsForProject(projectName);
      
      // Include model metadata if available
      const modelMetadata = {
        filename: `${projectName}.ifc`,
        element_count: elements.length,
        upload_timestamp: new Date().toISOString()
      };
      
      res.status(200).json({
        elements,
        modelMetadata
      });
    } catch (error) {
      console.error(`Error fetching elements for project ${projectName}:`, error);
      res.status(500).json({ error: "Failed to fetch project elements" });
    }
  }
);

app.get("/available-ebkp-codes", haltOnTimedout, (req, res) => {
  const codes = Object.keys(unitCostsByEbkph);
  res.status(200).json({ codes, count: codes.length });
});

app.get("/get-kennwerte/:projectName", 
  param('projectName').trim().notEmpty().withMessage('Project name is required'),
  handleValidationErrors,
  haltOnTimedout,
  async (req, res) => {
    const { projectName } = req.params;
    try {
      await connectToMongoDB();
      const db = getCostDb();
      
      const kennwerteDoc = await db.collection("kennwerte").findOne({ projectName });
      
      if (kennwerteDoc && kennwerteDoc.kennwerte) {
        res.status(200).json({ kennwerte: kennwerteDoc.kennwerte });
      } else {
        res.status(200).json({ kennwerte: {} });
      }
    } catch (error) {
      console.error("Error fetching kennwerte:", error);
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
  async (req, res) => {
    const { projectName, kennwerte } = req.body;
    
    try {
      await connectToMongoDB();
      const db = getCostDb();
      
      // Save kennwerte to database
      await db.collection("kennwerte").updateOne(
        { projectName },
        { 
          $set: { 
            kennwerte,
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
      
      // Update the in-memory cache
      Object.assign(unitCostsByEbkph, kennwerte);
      
      res.status(200).json({ message: "Kennwerte saved successfully" });
    } catch (error) {
      console.error("Error saving kennwerte:", error);
      res.status(500).json({ error: "Failed to save kennwerte" });
    }
  }
);

app.post("/reapply-costs", 
  strictLimiter,
  body('projectName').trim().notEmpty().withMessage('Project name is required'),
  handleValidationErrors,
  haltOnTimedout,
  async (req, res) => {
    const { projectName } = req.body;
    console.log(`Re-applying costs for project: ${projectName}`);
    // In a real scenario, this would trigger a background job
    res.status(200).json({ message: "Cost re-application process initiated" });
  }
);

app.post("/confirm-costs", 
  strictLimiter,
  body('data').isArray().withMessage('Data must be an array'),
  body('data.*.id').notEmpty().withMessage('Each element must have an id'),
  body('project').optional().trim().notEmpty(),
  handleValidationErrors,
  haltOnTimedout,
  async (req, res) => {
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
      
      console.log(`Sent ${kafkaMessage.data.length} cost elements to Kafka for project ${kafkaMessage.project}`);
      
      res.status(200).json({
        status: "success",
        message: `Successfully sent ${kafkaMessage.data.length} cost elements`,
        count: kafkaMessage.data.length
      });
    } catch (error) {
      console.error("Error sending cost data to Kafka:", error);
      res.status(500).json({ 
        status: "error",
        error: "Failed to send cost data to Kafka" 
      });
    }
  }
);

// --- Health Check ---
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    kafkaProducer: costProducerConnected ? "CONNECTED" : "DISCONNECTED",
    timestamp: new Date().toISOString(),
  });
});

// --- 404 Handler ---
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    res.status(403).json({ error: 'Invalid CSRF token' });
  } else if (err.message === 'Not allowed by CORS') {
    res.status(403).json({ error: 'CORS policy violation' });
  } else if (req.timedout) {
    res.status(503).json({ error: 'Request timeout' });
  } else {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

const server = http.createServer(app);

async function run() {
  await connectToMongoDB();
  await loadUnitCostsFromDatabase(); // Load costs on startup
  console.log("MongoDB connected.");
  
  await producer.connect();
  costProducerConnected = true;
  console.log("Kafka Producer connected.");

  producer.on(producer.events.DISCONNECT, () => {
      costProducerConnected = false;
    console.log("Kafka Producer disconnected.");
  });

  server.listen(config.server.port, () => {
    console.log(`HTTP server listening on port ${config.server.port}`);
  });
}

run().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  server.close(() => {
    producer.disconnect().then(() => process.exit(0));
  });
});
