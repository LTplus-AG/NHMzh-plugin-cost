/* eslint-disable */
const { Kafka } = require("kafkajs");
const WebSocket = require("ws");
const http = require("http");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { ObjectId } = require("mongodb");

// Import MongoDB functions
const {
  connectToMongoDB,
  updateProjectCostSummary,
  getCostDataForElement,
  saveCostData,
  saveCostDataBatch,
  getElementEbkpCode,
  getAllProjects, // <-- Import getAllProjects
} = require("./mongodb");

// Load environment variables
dotenv.config();

// Configuration
const config = {
  kafka: {
    broker: process.env.KAFKA_BROKER || "broker:29092",
    topic: process.env.KAFKA_TOPIC || "qto-elements",
    costTopic: process.env.KAFKA_COST_TOPIC || "cost-data",
    groupId: process.env.KAFKA_GROUP_ID || "plugin-cost-consumer",
  },
  websocket: {
    port: parseInt(process.env.WEBSOCKET_PORT || "8001"),
  },
  storage: {
    elementFile: process.env.ELEMENT_FILE || "ifc_elements.json",
    saveInterval: parseInt(process.env.SAVE_INTERVAL || "300000"), // 5 minutes
  },
  mongodb: {
    enabled: true, // Always enable MongoDB
    database: process.env.MONGODB_DATABASE || "cost",
    costCollection: process.env.MONGODB_COST_COLLECTION || "costData",
    elementsCollection: process.env.MONGODB_ELEMENTS_COLLECTION || "elements",
  },
};

// Additional validation for database/collection names
if (!config.mongodb.database) {
  throw new Error("MONGODB_DATABASE environment variable is required.");
}
if (!config.mongodb.costCollection) {
  throw new Error("MONGODB_COST_COLLECTION environment variable is required.");
}
if (!config.mongodb.elementsCollection) {
  throw new Error(
    "MONGODB_ELEMENTS_COLLECTION environment variable is required."
  );
}

// Store unit costs by EBKPH code in memory
const unitCostsByEbkph = {};

// Function to load unit costs from database into memory
async function loadUnitCostsFromDatabase() {
  try {
    const { costDb } = await connectToMongoDB();
    if (!costDb) {
      console.warn("Cost DB connection not available, cannot load unit costs.");
      return;
    }

    // Clear existing unit costs
    Object.keys(unitCostsByEbkph).forEach(key => delete unitCostsByEbkph[key]);

    // Load unit costs from the costData collection
    const costData = await costDb.collection("costData").find({
      unit_cost: { $gt: 0 } // Only load entries with unit_cost > 0
    }).toArray();
    
    let loadedCount = 0;
    costData.forEach(cost => {
      if (cost.ebkp_code && cost.unit_cost > 0) {
        const normalizedCode = normalizeEbkpCode(cost.ebkp_code);
        unitCostsByEbkph[normalizedCode] = {
          cost_unit: cost.unit_cost,
          originalCode: cost.ebkp_code,
          currency: cost.currency || 'CHF',
          source: 'database',
          project_id: cost.project_id,
          timestamp: cost.updated_at || cost.created_at
        };
        loadedCount++;
      }
    });

    console.log(`📊 Loaded ${loadedCount} unit costs from database into memory`);
    
    // Log some examples for debugging
    const codes = Object.keys(unitCostsByEbkph).slice(0, 5);
    if (codes.length > 0) {
      console.log(`📋 Sample unit costs: ${codes.map(code => `${code}=${unitCostsByEbkph[code].cost_unit}`).join(', ')}`);
    }
    
  } catch (error) {
    console.error("Error loading unit costs from database:", error);
  }
}

// Store IFC elements by EBKPH code
const ifcElementsByEbkph = {};

// Parse allowed CORS origins
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o);
console.log("Allowed CORS Origins:", allowedOrigins);

// Track elements to prevent duplicates
const processedElementIds = new Set();

// Storage for elements by project
const elementsByProject = {};

// Add at the top with other global variables
let cachedMatches = null;
let lastMatchTimestamp = null;
const MATCH_CACHE_DURATION = parseInt(
  process.env.MATCH_CACHE_DURATION_MS || "300000"
); // Default 5 minutes

// Add state tracking for the cost producer connection
let costProducerConnected = false;

// Add this near the top of the file, with other globals
// Track elements already sent to Kafka to prevent duplicates
// const kafkaSentElements = new Set();
// const KAFKA_DEDUP_TIMEOUT = 60 * 60 * 1000; // 1 hour

// Add a simple in-memory store for project metadata near the top
const projectMetadataStore = {}; // Use object as a map

console.log("Starting WebSocket server with configuration:", {
  kafkaBroker: config.kafka.broker,
  kafkaTopic: config.kafka.topic,
  kafkaCostTopic: config.kafka.costTopic,
  websocketPort: config.websocket.port,
  elementFile: config.storage.elementFile,
  mongodbEnabled: config.mongodb.enabled,
  mongodbDatabase: config.mongodb.database,
  mongodbCostCollection: config.mongodb.costCollection,
  mongodbElementsCollection: config.mongodb.elementsCollection,
});

// Setup Kafka client
const kafka = new Kafka({
  clientId: "plugin-cost-websocket",
  brokers: [config.kafka.broker],
  retry: {
    initialRetryTime: 1000,
    retries: 10,
  },
});

// Create producer for admin operations
const producer = kafka.producer();
const costProducer = kafka.producer();
const admin = kafka.admin();

// Create consumer
const consumer = kafka.consumer({ groupId: config.kafka.groupId });

// Create HTTP server for both health check and WebSocket
const server = http.createServer((req, res) => {
  // CORS handling for all routes
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Add payload size check for POST requests
  if (req.method === "POST") {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const maxSize = 1048576; // 1MB limit
    
    if (contentLength > maxSize) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Payload too large",
        message: "Request body exceeds 1MB limit. Please reduce the amount of data or use batch processing.",
        maxSize: "1MB"
      }));
      return;
    }
  }

  // --- CORS Handling --- START ---
  const requestOrigin = req.headers.origin;
  let originAllowed = false;

  if (requestOrigin) {
    if (allowedOrigins.includes(requestOrigin)) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      originAllowed = true;
    } else {
      // Optionally log disallowed origins
      // console.warn(`CORS: Origin ${requestOrigin} not allowed.`);
    }
  } else if (!requestOrigin && req.method !== "OPTIONS") {
    // Allow requests with no origin header (e.g., curl, server-to-server, redirects)
    // Browsers typically always send Origin for cross-origin requests
    originAllowed = true;
  }

  // Set common CORS headers only if origin is allowed or not applicable
  if (originAllowed || req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS, PUT, DELETE, HEAD"
    ); // Added common methods
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    ); // Added common headers
  }
  // --- CORS Handling --- END ---

  // Handle OPTIONS pre-flight requests
  if (req.method === "OPTIONS") {
    if (originAllowed) {
      res.writeHead(204); // OK, No Content
    } else {
      // If origin was present but not allowed
      res.writeHead(403); // Forbidden
    }
    res.end();
    return;
  }

  // If origin was required, present, but not allowed, block the request
  if (requestOrigin && !originAllowed) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: `CORS: Origin ${requestOrigin} is not allowed.` })
    );
    return;
  }

  // Set CORS headers for all requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Simple health check endpoint
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "UP",
        kafkaConsumer: consumer.isRunning ? "CONNECTED" : "DISCONNECTED",
        costProducer: costProducerConnected ? "CONNECTED" : "DISCONNECTED",
        clients: clients.size,
        topics: [config.kafka.topic, config.kafka.costTopic],
        elements: {
          stored: processedElementIds.size,
          byEbkph: Object.keys(ifcElementsByEbkph).length,
          byProject: Object.keys(elementsByProject).length,
        },
      })
    );
  }
  // Get available EBKP codes endpoint
  else if (req.url === "/available-ebkp-codes" && req.method === "GET") {
    try {
      // Get unique EBKP codes from the loaded unit costs
      const codes = Object.keys(unitCostsByEbkph);
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        codes,
        count: codes.length 
      }));
    } catch (error) {
      console.error("Error getting available EBKP codes:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "Internal server error" 
      }));
    }
  }
  // Get kennwerte endpoint
  else if (req.method === "GET" && req.url.startsWith("/get-kennwerte/")) {
    
    // Extract project name from URL
    const projectName = decodeURIComponent(req.url.split("/get-kennwerte/")[1]);
    
    if (!projectName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        status: "error", 
        message: "Project name is required" 
      }));
      return;
    }
    
    (async () => {
      try {
        // Connect to MongoDB
        const { costDb, qtoDb } = await connectToMongoDB();
        
        // Find the project
        const qtoProject = await qtoDb.collection("projects").findOne({
          name: { $regex: new RegExp(`^${projectName}$`, "i") }
        });
        
        if (!qtoProject) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ 
            status: "error", 
            message: "Project not found" 
          }));
          return;
        }
        
        // Get kennwerte for this project
        console.log(`[get-kennwerte] Looking for project: ${projectName}, project_id: ${qtoProject._id}`);
        const costData = await costDb.collection("costData").find({
          project_id: qtoProject._id,  // Use ObjectId directly, not toString()
          unit_cost: { $gt: 0 }
        }).toArray();
        
        console.log(`[get-kennwerte] Found ${costData.length} cost data entries for project ${projectName}`);
        
        // Convert to kennwerte format
        const kennwerte = {};
        costData.forEach(item => {
          if (item.ebkp_code) {
            kennwerte[item.ebkp_code] = item.unit_cost;
          }
        });
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          status: "success", 
          kennwerte,
          count: Object.keys(kennwerte).length
        }));
        
      } catch (error) {
        console.error("Error fetching kennwerte:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          status: "error", 
          message: "Internal server error" 
        }));
      }
    })();
  }
  // Save kennwerte endpoint
  else if (req.url === "/save-kennwerte" && req.method === "POST") {
    
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const { projectName, kennwerte } = data;
        
        if (!projectName || !kennwerte) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing projectName or kennwerte" }));
          return;
        }
        
        // Connect to MongoDB and get database references
        const { costDb, qtoDb } = await connectToMongoDB();
        
        // Find the project
        const qtoProject = await qtoDb.collection("projects").findOne({
          name: { $regex: new RegExp(`^${projectName}$`, "i") }
        });
        
        if (!qtoProject) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Project ${projectName} not found` }));
          return;
        }
        
        const projectId = qtoProject._id;
        const timestamp = new Date();
        
        console.log(`[save-kennwerte] Saving kennwerte for project: ${projectName}, project_id: ${projectId}`);
        
        // Clear existing cost data for this project
        const deleteResult = await costDb.collection("costData").deleteMany({
          project_id: projectId
        });
        console.log(`[save-kennwerte] Deleted ${deleteResult.deletedCount} existing kennwerte for project ${projectName}`);
        
        // Insert new cost data
        const costDataDocs = Object.entries(kennwerte)
          .filter(([code, value]) => Number(value) > 0)
          .map(([ebkp_code, unit_cost]) => ({
            project_id: projectId,
            ebkp_code,
            unit_cost: Number(unit_cost),
            currency: "CHF",
            created_at: timestamp,
            updated_at: timestamp
          }));
        
        if (costDataDocs.length > 0) {
          await costDb.collection("costData").insertMany(costDataDocs);
          console.log(`Saved ${costDataDocs.length} kennwerte for project ${projectName}`);
          
          // Reload unit costs into memory
          await loadUnitCostsFromDatabase();
        }
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          status: "success",
          savedCount: costDataDocs.length 
        }));
        
      } catch (error) {
        console.error("Error saving kennwerte:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  }
  // Endpoint to get all projects
  else if (req.url === "/projects") {
    if (!config.mongodb.enabled) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MongoDB is not enabled" }));
      return;
    }

    (async () => {
      try {
        const projects = await getAllProjects();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(projects)); // Send the array of projects
      } catch (error) {
        console.error("Error getting all projects:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Failed to get projects: ${error.message}` })
        );
      }
    })();
  }
  // Endpoint to get all stored elements
  else if (req.url === "/elements") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        elementCount: processedElementIds.size,
        ebkphCodes: Object.keys(ifcElementsByEbkph),
        projects: Object.keys(elementsByProject),
        timestamp: new Date().toISOString(),
      })
    );
  }
  // Get elements by EBKPH code
  else if (req.url.startsWith("/elements/ebkph/")) {
    const ebkpCode = req.url.replace("/elements/ebkph/", "");
    const normalizedCode = normalizeEbkpCode(ebkpCode);
    const elements = ifcElementsByEbkph[normalizedCode] || [];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ebkphCode: ebkpCode,
        normalizedCode,
        elements,
        count: elements.length,
        hasCost: unitCostsByEbkph[normalizedCode] !== undefined,
      })
    );
  }
  // Get elements by project
  else if (req.url.startsWith("/elements/project/")) {
    const projectName = decodeURIComponent(
      req.url.replace("/elements/project/", "")
    );
    const projectData = elementsByProject[projectName] || {};

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        project: projectName,
        ebkphCodes: Object.keys(projectData),
        elementCount: Object.values(projectData).reduce(
          (count, elements) => count + elements.length,
          0
        ),
      })
    );
  }
  // Get project elements by name (/project-elements/:projectName)
  else if (req.url.startsWith("/project-elements/")) {
    const projectName = decodeURIComponent(
      req.url.replace("/project-elements/", "")
    );

    // Check if MongoDB is enabled
    if (!config.mongodb.enabled) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MongoDB is not enabled" }));
      return;
    }

    // Fetch elements directly from qto.elements
    (async () => {
      let elements = [];
      let sourceDb = "qto.elements"; // Source is always qto.elements now
      try {
        const { costDb, qtoDb } = await connectToMongoDB();

        if (!qtoDb) {
          throw new Error("Failed to connect to QTO database.");
        }

        // 1. Find the project ID using the project name (from qtoDb)
        const qtoProject = await qtoDb.collection("projects").findOne({
          name: { $regex: new RegExp(`^${projectName}$`, "i") },
        });

        if (!qtoProject) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `Project ${projectName} not found in QTO DB`,
            })
          );
          return;
        }
        const projectId = qtoProject._id;

        // --- Extract Model Metadata ---
        const modelMetadata = {
          filename: qtoProject.metadata?.filename || `${projectName}_model.ifc`, // Fallback filename
          timestamp:
            qtoProject.metadata?.upload_timestamp ||
            qtoProject.metadata?.timestamp ||
            qtoProject.updated_at?.toISOString() ||
            new Date().toISOString(), // Fallback timestamp
        };

        // 2. Directly query the qto.elements collection using the projectId
        elements = await qtoDb
          .collection("elements")
          .find({
            project_id: projectId,
            status: "active", // Only include elements with active status
          })
          .toArray();

        // Check if any pending elements were skipped
        const pendingCount = await qtoDb.collection("elements").countDocuments({
          project_id: projectId,
          status: "pending",
        });

        if (pendingCount > 0) {
          console.log(
            `Skipped ${pendingCount} QTO elements with pending status for project ${projectName}`
          );
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        // Return the new structure with modelMetadata and elements
        res.end(JSON.stringify({ modelMetadata, elements }));
      } catch (error) {
        console.error(
          `Error getting elements (from ${sourceDb}) for project ${projectName}:`,
          error
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Failed to get elements: ${error.message}` })
        );
      }
    })(); // Immediately invoke the async function
  }
  // Get project cost data (/project-cost/:projectName)
  else if (req.url.startsWith("/project-cost/")) {
    const projectName = decodeURIComponent(
      req.url.replace("/project-cost/", "")
    );

    // Check if MongoDB is enabled
    if (!config.mongodb.enabled) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MongoDB is not enabled" }));
      return;
    }

    // Try to get project cost data directly using project name
    (async () => {
      try {
        // First ensure we have database connections
        const { costDb, qtoDb } = await connectToMongoDB();

        if (!qtoDb || !costDb) {
          // If we couldn't get DB connections but other data is available, return what we can
          if (elementsByProject[projectName]) {
            // Return a simplified response with elements count but no cost data
            const elements = Object.values(
              elementsByProject[projectName]
            ).flat();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                elements_count: elements.length,
                cost_data_count: 0,
                total_from_cost_data: 0,
                total_from_elements: 0,
                updated_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                note: "Cost data is unavailable, but elements were loaded from cache",
              })
            );
            return;
          }

          // If no data at all, return 404
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Project not found and database connection failed",
              elements_count: 0,
              cost_data_count: 0,
              total_from_cost_data: 0,
              total_from_elements: 0,
            })
          );
          return;
        }

        // Now that we have DB connections, find the project
        const qtoProject = await qtoDb.collection("projects").findOne({
          name: { $regex: new RegExp(`^${projectName}$`, "i") },
        });

        if (!qtoProject) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: `Project ${projectName} not found` })
          );
          return;
        }

        const projectId = qtoProject._id;

        // First check if we have a cost summary
        const existingSummary = await costDb
          .collection("costSummaries")
          .findOne({
            project_id: projectId,
          });

        // If a summary exists, update it to ensure it's current
        if (existingSummary) {
          console.log(`Found existing cost summary for project ${projectName}`);
        }

        // Always recalculate to ensure up-to-date data
        const costSummary = await updateProjectCostSummary(projectId);

        if (costSummary.error) {
          throw new Error(costSummary.error);
        }

        // If we have elements count but zero cost, double-check elements directly
        if (
          costSummary.elements_count > 0 &&
          costSummary.total_from_elements === 0
        ) {
          // Get all cost elements and manually calculate total
          const costElements = await costDb
            .collection("costElements")
            .find({ project_id: projectId })
            .toArray();

          if (costElements.length > 0) {
            // Create a map to avoid double-counting
            const processedIds = new Set();
            let manualTotal = 0;

            costElements.forEach((element) => {
              const id = element._id.toString();
              if (!processedIds.has(id) && element.total_cost) {
                processedIds.add(id);
                manualTotal += element.total_cost;
              }
            });

            if (manualTotal > 0) {
              console.log(
                `Manual calculation found total cost: ${manualTotal}`
              );
              costSummary.total_from_elements = manualTotal;

              // Update the summary with the corrected total
              await costDb.collection("costSummaries").updateOne(
                { project_id: projectId },
                {
                  $set: {
                    total_from_elements: manualTotal,
                    updated_at: new Date(),
                  },
                }
              );
            }
          }
        }

        // Return only the specified fields
        const simplifiedSummary = {
          created_at: costSummary.created_at,
          elements_count: costSummary.elements_count,
          cost_data_count: costSummary.cost_data_count,
          total_from_cost_data: costSummary.total_from_cost_data,
          total_from_elements: costSummary.total_from_elements,
          updated_at: costSummary.updated_at,
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(simplifiedSummary));
      } catch (error) {
        console.error(
          `Error getting cost data for project ${projectName}:`,
          error
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Failed to get cost data: ${error.message}` })
        );
      }
    })();
  }
  // Get element cost data (/element-cost/:elementId)
  else if (req.url.startsWith("/element-cost/")) {
    const elementId = req.url.replace("/element-cost/", "");

    // Check if MongoDB is enabled
    if (!config.mongodb.enabled) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MongoDB is not enabled" }));
      return;
    }

    getCostDataForElement(elementId)
      .then((costData) => {
        if (costData) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(costData));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Cost data not found for element" }));
        }
      })
      .catch((error) => {
        console.error(
          `Error getting cost data for element ${elementId}:`,
          error
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Failed to get cost data: ${error.message}` })
        );
      });
  }
  // Handle cost update requests (/send-cost-update)
  else if (req.url === "/send-cost-update" && req.method === "POST") {
    // Read the full request body
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        // Parse JSON body
        const data = JSON.parse(body);
        const payload = data.payload || {};

        // Validate minimum required data - we need projectName now, ID is optional
        if (!payload.projectName) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Missing required field 'projectName' in payload",
            })
          );
          return;
        }

        // Send to Kafka
        try {
          // Create a proper message
          const message = {
            key: payload.projectId || payload.projectName,
            value: JSON.stringify(data),
          };

          // Produce the message to Kafka
          await producer.send({
            topic: config.kafka.costTopic || "cost-data",
            messages: [message],
          });

          // Update internal elements mapping if project is loaded
          const projectName = payload.projectName;

          // Try to get actual ID if we don't have it
          let projectId = payload.projectId;
          if (!projectId && config.mongodb.enabled) {
            // Try to look up project ID from elements if we don't have it
            try {
              const project = await qtoDb.collection("projects").findOne({
                name: { $regex: new RegExp(`^${projectName}$`, "i") },
              });

              if (project) {
                projectId = project._id.toString();
              }
            } catch (error) {
              console.warn(
                `Couldn't find project ID for ${projectName}:`,
                error.message
              );
            }
          }

          // Send success response
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "success",
              message: "Cost update sent to Kafka",
              timestamp: new Date().toISOString(),
            })
          );
        } catch (error) {
          console.error("Error sending cost update to Kafka:", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `Failed to send cost update: ${error.message}`,
            })
          );
        }
      } catch (error) {
        console.error("Error parsing cost update request:", error);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Invalid request format: ${error.message}` })
        );
      }
    });
  }
  // Add new endpoint for debugging EBKPH code matching
  else if (req.url === "/debug/codes") {
    // Collect Excel cost codes
    const excelCodes = Object.keys(unitCostsByEbkph).map((code) => ({
      code,
      normalized: code,
      originalCode: unitCostsByEbkph[code].originalCode || code,
      unitCost: unitCostsByEbkph[code].cost_unit,
    }));

    // Collect IFC element codes
    const ifcCodes = Object.keys(ifcElementsByEbkph).map((code) => ({
      code,
      normalized: code,
      elementCount: ifcElementsByEbkph[code].length,
    }));

    // Find potential matches (codes that should match but don't)
    const potentialMatches = [];
    const automaticMatches = [];

    ifcCodes.forEach((ifcCode) => {
      const match = findBestEbkphMatch(ifcCode.code);
      if (match && match.method !== "direct") {
        automaticMatches.push({
          ifcCode: ifcCode.code,
          matchedWith: match.code,
          method: match.method,
          unitCost: match.costInfo.cost_unit,
          elementCount: ifcCode.elementCount,
        });
      }
    });

    excelCodes.forEach((excelCode) => {
      // Check for close matches that don't match exactly
      ifcCodes.forEach((ifcCode) => {
        // Simple comparison: codes that match when lowercased and spaces/zeros removed
        const simplifiedExcel = excelCode.originalCode
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace(/^([a-z])0+(\d+)/g, "$1$2");
        const simplifiedIfc = ifcCode.code
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace(/^([a-z])0+(\d+)/g, "$1$2");

        if (
          simplifiedExcel === simplifiedIfc &&
          excelCode.code !== ifcCode.code
        ) {
          potentialMatches.push({
            excelCode: excelCode.originalCode,
            normalizedExcel: excelCode.code,
            ifcCode: ifcCode.code,
            normalizedIfc: ifcCode.normalized,
            simplifiedExcel,
            simplifiedIfc,
            reason: "Similar but not matching exactly",
          });
        }
      });
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          excelCodes,
          ifcCodes,
          potentialMatches,
          automaticMatches,
          matchingCodes: excelCodes
            .filter((ec) => ifcCodes.some((ic) => ic.code === ec.code))
            .map((ec) => ec.code),
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ) // Pretty print JSON
    );
  } else if (req.url === "/send-test-cost") {
    sendTestCostMessage()
      .then((result) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: result ? "success" : "error",
            message: result
              ? "Test cost message sent"
              : "Failed to send test cost message",
            timestamp: new Date().toISOString(),
          })
        );
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      });
  } else if (req.url.startsWith("/test-kafka-message/")) {
    const projectName = decodeURIComponent(
      req.url.replace("/test-kafka-message/", "")
    );

    (async () => {
      try {
        // Connect to MongoDB
        const { costDb, qtoDb } = await connectToMongoDB();

        if (!qtoDb) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to connect to MongoDB" }));
          return;
        }

        // Find project
        const project = await qtoDb.collection("projects").findOne({
          name: { $regex: new RegExp(`^${projectName}$`, "i") },
        });

        if (!project) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: `Project ${projectName} not found` })
          );
          return;
        }

        // Get filename from project metadata, if available
        const filename = project.metadata?.filename || "";

        // Get first element
        const element = await qtoDb.collection("elements").findOne({
          project_id: project._id,
        });

        if (!element) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: `No elements found for project ${projectName}`,
            })
          );
          return;
        }

        // Prepare element with cost data
        const enhancedElement = {
          ...element,
          project: projectName,
          filename: filename, // Use filename from project metadata
          cost_unit: 100, // Sample value
          cost: 1000, // Sample value
          element_id: element._id.toString(),
          id: element._id.toString(),
        };

        // Send to Kafka
        const result = await sendEnhancedElementToKafka(enhancedElement);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: result,
            message: result
              ? "Element sent to Kafka successfully"
              : "Failed to send element to Kafka",
            elementId: element._id.toString(),
            project: projectName,
            filename: filename,
          })
        );
      } catch (error) {
        console.error(`Error testing Kafka message:`, error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
    })();
  } else if (req.url === "/send-test-cost-batch") {
    sendTestCostBatch()
      .then((result) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: result ? "success" : "error",
            message: result
              ? "Test cost batch sent successfully"
              : "Failed to send test cost batch",
            timestamp: new Date().toISOString(),
          })
        );
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      });
  } else if (data && data.type === "save_cost_batch_full") {
    // Extract payload data
    const { projectName, matchedItems, allExcelItems } = data.payload || {};

    // Use promise-based approach instead of await
    const saveFullBatchResult = async (
      matchedItems,
      allExcelItems,
      projectName,
      kafkaSender
    ) => {
      const matchedResult = await saveCostDataBatch(
        matchedItems,
        allExcelItems,
        projectName,
        kafkaSender
      );
      return matchedResult;
    };

    // Call the function and handle the promise
    saveFullBatchResult(
      matchedItems,
      allExcelItems,
      projectName,
      sendCostElementsToKafka
    )
      .then((result) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "success",
            message: `Processed batch for ${projectName}`,
            result,
          })
        );
      })
      .catch((error) => {
        console.error("Error in save_cost_batch_full:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "error",
            message: error.message,
          })
        );
      });

    return;
  } else if (req.url === "/save_excel_data" || req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        // Parse JSON body
        const data = JSON.parse(body);
        const { projectName, excelItems, replaceExisting } = data.payload || {};
        const messageId = data.messageId;

        if (!projectName || !excelItems || excelItems.length === 0) {
          console.error("Invalid save_excel_data payload:", data.payload);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              type: "save_excel_data_response",
              messageId,
              status: "error",
              message: "Invalid payload. Missing projectName or excelItems.",
            })
          );
          return;
        }

        try {
          // Connect to MongoDB and get database references
          const { costDb, qtoDb } = await connectToMongoDB();

          // Find or create the project
          let projectId;

          const qtoProject = await qtoDb.collection("projects").findOne({
            name: { $regex: new RegExp(`^${projectName}$`, "i") },
          });

          if (qtoProject) {
            projectId = qtoProject._id;
          } else {
            projectId = new ObjectId();

            await qtoDb.collection("projects").insertOne({
              _id: projectId,
              name: projectName,
              type: "BimProject",
              status: "active",
              metadata: {
                source: "cost-plugin",
                has_cost_data: true,
              },
              created_at: new Date(),
              updated_at: new Date(),
            });
          }

          if (replaceExisting) {
            const deleteResult = await costDb
              .collection("costData")
              .deleteMany({
                project_id: projectId,
              });

            const costDataToSave = excelItems
              .map((item, index) => {
                // Skip items with unit_cost of 0
                const unitCost = parseFloat(item.kennwert || 0) || 0;
                const totalCost =
                  parseFloat(item.totalChf || item.chf || 0) || 0; // Also get totalCost
                const ebkpCode = item.ebkp || "";

                // CRITICAL CHANGE: Include items if they have EITHER unit cost OR total cost
                if (!ebkpCode || (unitCost <= 0 && totalCost <= 0)) {
                  // ebkpCode must also exist
                  return null; // Return null for items to be filtered out
                }

                // Return valid items as before
                return {
                  _id: new ObjectId(),
                  project_id: projectId,
                  ebkp_code: ebkpCode,
                  category: item.bezeichnung || item.category || "",
                  level: item.level || "",
                  unit_cost: unitCost,
                  quantity: parseFloat(item.menge || 0) || 0,
                  total_cost: totalCost,
                  currency: "CHF",
                  metadata: {
                    source: "excel-import",
                    timestamp: new Date(),
                    original_data: {
                      einheit: item.einheit || "m²",
                      kommentar: item.kommentar || "",
                      is_parent: !!(item.children && item.children.length > 0),
                    },
                  },
                  created_at: new Date(),
                  updated_at: new Date(),
                };
              })
              .filter((item) => item !== null); // Filter out null items

            let insertedCount = 0;
            if (costDataToSave.length > 0) {
              const costDataResult = await costDb
                .collection("costData")
                .insertMany(costDataToSave);
              insertedCount = costDataResult.insertedCount;
            }
            // Send success response for replace mode
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                type: "save_excel_data_response",
                messageId,
                status: "success",
                message: `Successfully replaced data with ${insertedCount} Excel items.`, // Updated message
                insertedCount: insertedCount,
              })
            );
          } else {
            const bulkOps = excelItems
              .map((item) => {
                // Skip items with zero unit cost
                const unitCost = parseFloat(item.kennwert || 0) || 0;
                const totalCost =
                  parseFloat(item.totalChf || item.chf || 0) || 0; // Also get totalCost
                const ebkpCode = item.ebkp || "";

                if (!ebkpCode || (unitCost <= 0 && totalCost <= 0)) {
                  // ebkpCode must also exist
                  return null;
                }

                // Define the update document
                const updateDoc = {
                  project_id: projectId,
                  ebkp_code: ebkpCode,
                  category: item.bezeichnung || item.category || "",
                  level: item.level || "",
                  unit_cost: unitCost,
                  quantity: parseFloat(item.menge || 0) || 0,
                  total_cost: totalCost,
                  currency: "CHF",
                  metadata: {
                    source: "excel-import",
                    timestamp: new Date(),
                    original_data: {
                      einheit: item.einheit || "m²",
                      kommentar: item.kommentar || "",
                      is_parent: !!(item.children && item.children.length > 0),
                    },
                  },
                  updated_at: new Date(),
                };

                // Return the bulk operation object
                return {
                  updateOne: {
                    filter: { project_id: projectId, ebkp_code: ebkpCode }, // Match by project and EBKP code
                    update: {
                      $set: updateDoc, // Set all fields
                      $setOnInsert: { created_at: new Date() }, // Set created_at only on insert
                    },
                    upsert: true, // Insert if no match is found
                  },
                };
              })
              .filter((op) => op !== null); // Filter out skipped items

            let upsertedCount = 0;
            let modifiedCount = 0;
            if (bulkOps.length > 0) {
              const bulkResult = await costDb
                .collection("costData")
                .bulkWrite(bulkOps);
              upsertedCount = bulkResult.upsertedCount;
              modifiedCount = bulkResult.modifiedCount;
            }

            // Send success response for update/upsert mode
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                type: "save_excel_data_response",
                messageId,
                status: "success",
                message: `Successfully updated/inserted ${
                  upsertedCount + modifiedCount
                } Excel items.`, // Updated message
                insertedCount: upsertedCount, // Report how many new ones were added
                updatedCount: modifiedCount, // Report how many were updated
              })
            );
          }
        } catch (error) {
          console.error(
            `Error saving Excel data for project '${projectName}':`,
            error
          );
          // Send error response
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              type: "save_excel_data_response",
              messageId,
              status: "error",
              message: `Failed to save Excel data: ${error.message}`,
            })
          );
        }
      } catch (error) {
        console.error("Error parsing save_excel_data request:", error);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Invalid request format: ${error.message}` })
        );
      }
    });
  } else if (data.type === "ping") {
    ws.send(JSON.stringify({ type: "pong" }));
  }
});

// Setup WebSocket server on the same HTTP server
const wss = new WebSocket.Server({
  server,
  // Add WebSocket configs for better performance
  perMessageDeflate: false, // Disable per-message deflate to reduce CPU usage
  // Set keep-alive ping interval
  clientTracking: true,
  // Set timeout to automatically close inactive connections
  handleProtocols: () => "echo-protocol",
});

// Track active clients with IDs for better debugging
let nextClientId = 1;
const clients = new Map(); // Changed from Set to Map to store client IDs
let isKafkaConnected = false;

// Function to set up heartbeat mechanism for a client
function setupHeartbeat(ws, clientId) {
  // Mark the connection as alive
  ws.isAlive = true;

  // Set up ping handler
  ws.on("pong", () => {
    ws.isAlive = true;
  });
}

// Interval to ping clients and terminate dead connections
const heartbeatInterval = setInterval(() => {
  clients.forEach((ws, clientId) => {
    if (ws.isAlive === false) {
      ws.terminate();
      clients.delete(clientId);
      return;
    }

    ws.isAlive = false;
    try {
      ws.ping("", false);
    } catch (error) {
      console.error(`Error pinging client ${clientId}:`, error.message);
      ws.terminate();
      clients.delete(clientId);
    }
  });
}, 30000); // Check every 30 seconds

// Clean up the interval on server close
process.on("SIGINT", () => {
  clearInterval(heartbeatInterval);
  process.exit(0);
});

// Handle WebSocket connections
wss.on("connection", async (ws, req) => {
  const clientId = nextClientId++;
  ws.clientId = clientId;
  ws.lastPing = Date.now();
  clients.set(clientId, ws);

  // Set up ping/pong handlers
  ws.on("ping", () => {
    ws.lastPing = Date.now();
    ws.pong();
  });

  ws.on("pong", () => {
    ws.lastPing = Date.now();
  });

  // Handle incoming messages
  ws.on("message", async (message) => {
    // <-- Add async here
    try {
      const data = JSON.parse(message);

      // Handle delete project data request - new handler
      if (data.type === "delete_project_data") {
        const { projectName } = data.payload || {};
        const messageId = data.messageId;

        if (!projectName) {
          console.error("Invalid delete_project_data payload:", data.payload);
          ws.send(
            JSON.stringify({
              type: "delete_project_data_response",
              messageId,
              status: "error",
              message: "Invalid payload. Missing projectName.",
            })
          );
          return;
        }

        let costDb, qtoDb;
        try {
          // Ensure we have DB connections before proceeding
          const dbs = await connectToMongoDB();
          costDb = dbs.costDb;
          qtoDb = dbs.qtoDb;
          if (!costDb || !qtoDb) {
            throw new Error("Failed to get database handles.");
          }
        } catch (dbError) {
          console.error(
            "Database connection error during delete_project_data:",
            dbError
          );
          ws.send(
            JSON.stringify({
              type: "delete_project_data_response",
              messageId,
              status: "error",
              message: `Database connection error: ${dbError.message}`,
            })
          );
          return; // Stop if DB connection failed
        }

        try {
          // Find the project ID first
          const qtoProject = await qtoDb.collection("projects").findOne({
            name: { $regex: new RegExp(`^${projectName}$`, "i") },
          });

          if (!qtoProject) {
            // Project not found but don't treat it as an error
            ws.send(
              JSON.stringify({
                type: "delete_project_data_response",
                messageId,
                status: "success",
                message: `Project '${projectName}' not found, nothing to delete`,
                deletedCount: 0,
              })
            );
            return;
          }

          const projectId = qtoProject._id;

          // Delete all cost data for this project
          const costDataResult = await costDb
            .collection("costData")
            .deleteMany({ project_id: projectId });

          // Delete cost elements as well
          const costElementsResult = await costDb
            .collection("costElements")
            .deleteMany({ project_id: projectId });

          // Delete cost summaries
          const costSummariesResult = await costDb
            .collection("costSummaries")
            .deleteMany({ project_id: projectId });

          const totalDeleted =
            costDataResult.deletedCount +
            costElementsResult.deletedCount +
            costSummariesResult.deletedCount;

          // Send success response
          ws.send(
            JSON.stringify({
              type: "delete_project_data_response",
              messageId,
              status: "success",
              message: `Successfully deleted ${totalDeleted} cost data entries`,
              deletedCount: totalDeleted,
              details: {
                costData: costDataResult.deletedCount,
                costElements: costElementsResult.deletedCount,
                costSummaries: costSummariesResult.deletedCount,
              },
            })
          );
        } catch (error) {
          console.error(
            `Error deleting cost data for project '${projectName}':`,
            error
          );
          // Send error response
          ws.send(
            JSON.stringify({
              type: "delete_project_data_response",
              messageId,
              status: "error",
              message: `Failed to delete cost data: ${error.message}`,
            })
          );
        }
        return; // Ensure we don't fall through
      }

      // Handle request for available eBKP codes
      if (data.type === "get_available_ebkp_codes") {
        try {
          // Get all unique eBKP codes from elements and unit costs
          const allCodes = new Set([
            ...Object.keys(ifcElementsByEbkph),
            ...Object.keys(unitCostsByEbkph),
          ]);

          // Create a more detailed response with code information
          const codeDetails = Array.from(allCodes).map((code) => {
            // Count elements with this code
            const elements = ifcElementsByEbkph[code] || [];
            const elementCount = elements.length;

            // Check if we have costs for this code
            const hasCost = unitCostsByEbkph[code] !== undefined;

            // Calculate total area for this code
            const totalArea = elements.reduce((sum, element) => {
              return sum + parseFloat(element.quantity || element.area || 0);
            }, 0);

            return {
              code,
              elementCount,
              hasCost,
              totalArea,
              // Add the original format for troubleshooting
              originalFormat: code,
            };
          });

          // Send back as an array with detailed info
          const response = {
            type: "available_ebkp_codes",
            messageId: data.messageId,
            codes: Array.from(allCodes),
            codeDetails,
            timestamp: new Date().toISOString(),
          };

          ws.send(JSON.stringify(response));
          return;
        } catch (error) {
          console.error(
            "Error processing available eBKP codes request:",
            error
          );
          ws.send(
            JSON.stringify({
              type: "available_ebkp_codes",
              messageId: data.messageId,
              error: "Failed to get eBKP codes: " + error.message,
              codes: [],
              timestamp: new Date().toISOString(),
            })
          );
        }
        return;
      }

      // Handle request for code matching
      if (data.type === "request_code_matching") {
        try {
          // Force MongoDB load if requested
          if (data.debug?.forceMongoDB && config.mongodb.enabled) {
            await loadElementsFromMongoDB();
            // Force refresh matches after MongoDB load
            cachedMatches = null;
            lastMatchTimestamp = null;
          }

          // Get codes from the message
          const excelCodes = data.codes || [];

          // Some basic validation
          if (!excelCodes.length) {
            ws.send(
              JSON.stringify({
                type: "code_matching_info",
                messageId: data.messageId,
                status: "success",
                matchingCodes: [],
                matches: [],
                matchCount: 0,
                timestamp: new Date().toISOString(),
              })
            );
            return;
          }

          // Normalize the codes for better matching
          const normalizedCodes = excelCodes.map((code) =>
            normalizeEbkpCode(code)
          );

          try {
            // Get elements and unit costs
            const elementsList = Object.values(ifcElementsByEbkph).flat();

            // Process matches (will use cache if available)
            const matches = await batchProcessCodeMatches(
              elementsList,
              unitCostsByEbkph,
              data.debug?.forceRefresh || false
            );

            // Send back all matches in a single message with explicit status field
            const response = {
              type: "code_matching_info",
              messageId: data.messageId,
              status: "success",
              excelCodeCount: excelCodes.length,
              ifcCodeCount: Object.keys(ifcElementsByEbkph).length,
              matchingCodes: matches ? matches : [], // Always send an array even if empty
              matches: matches ? matches : [], // Send in both formats for compatibility
              matchCount: matches ? matches.length : 0,
              timestamp: new Date().toISOString(),
              isCached: !data.debug?.forceRefresh && cachedMatches !== null,
            };

            ws.send(JSON.stringify(response));
          } catch (error) {
            console.error("Error processing matches:", error);
            ws.send(
              JSON.stringify({
                type: "code_matching_info",
                messageId: data.messageId,
                status: "error",
                message: `Error processing matches: ${error.message}`,
                timestamp: new Date().toISOString(),
                matchingCodes: [], // Add empty arrays to ensure client doesn't crash
                matches: [],
                matchCount: 0,
              })
            );
          }
        } catch (error) {
          console.error("Error in code matching request:", error);
          ws.send(
            JSON.stringify({
              type: "code_matching_info",
              messageId: data.messageId,
              status: "error",
              message: error.message,
              timestamp: new Date().toISOString(),
              matchingCodes: [], // Add empty arrays to ensure client doesn't crash
              matches: [],
              matchCount: 0,
            })
          );
        }
        return;
      }
      // Handle request to save cost data batch
      else if (data.type === "save_cost_batch") {
        const { projectName, costItems } = data.payload || {};
        const messageId = data.messageId;

        if (!projectName || !costItems || costItems.length === 0) {
          console.error("Invalid save_cost_batch payload:", data.payload);
          ws.send(
            JSON.stringify({
              type: "save_cost_batch_response",
              messageId,
              status: "error",
              message: "Invalid payload. Missing projectName or costItems.",
            })
          );
          return;
        }

        try {
          // Call the MongoDB function to save the batch directly
          // This function already handles creating/finding the project and elements
          const result = await saveCostDataBatch(
            costItems,
            projectName,
            sendEnhancedElementToKafka
          );

          // Send success response
          ws.send(
            JSON.stringify({
              type: "save_cost_batch_response",
              messageId,
              status: "success",
              message: `Successfully saved ${
                result.insertedCount || 0
              } cost items.`,
              insertedCount: result.insertedCount || 0,
            })
          );
        } catch (error) {
          console.error(
            `Error saving cost batch for project '${projectName}':`,
            error
          );
          // Send error response
          ws.send(
            JSON.stringify({
              type: "save_cost_batch_response",
              messageId,
              status: "error",
              message: `Failed to save cost data: ${error.message}`,
            })
          );
        }
        return; // Ensure we don't fall through
      }
      // Handle request to save cost data batch with full Excel data
      else if (data.type === "save_cost_batch_full") {
        const { projectName, matchedItems, allExcelItems } = data.payload || {};
        const messageId = data.messageId;

        if (!projectName || !matchedItems || !allExcelItems) {
          console.error("Invalid save_cost_batch_full payload:", data.payload);
          ws.send(
            JSON.stringify({
              type: "save_cost_batch_full_response",
              messageId,
              status: "error",
              message:
                "Invalid payload. Missing projectName, matchedItems, or allExcelItems.",
            })
          );
          return;
        }

        try {
          // Define the helper function to accept the Kafka sender
          const saveFullBatchResult = async (
            matchedItems,
            allExcelItems,
            projectName,
            kafkaSender // Added parameter
          ) => {
            // First ensure we're connected to the database
            const { costDb, qtoDb } = await connectToMongoDB();

            // Step 1: Find or create the project
            let projectId;

            const qtoProject = await qtoDb.collection("projects").findOne({
              name: { $regex: new RegExp(`^${projectName}$`, "i") },
            });

            if (qtoProject) {
              projectId = qtoProject._id;
            } else {
              projectId = new ObjectId();

              await qtoDb.collection("projects").insertOne({
                _id: projectId,
                name: projectName,
                type: "BimProject",
                status: "active",
                metadata: {
                  source: "cost-plugin",
                  has_cost_data: true,
                },
                created_at: new Date(),
                updated_at: new Date(),
              });
            }

            // The costData collection already contains the Excel data from the upload step
            await costDb
              .collection("costElements")
              .deleteMany({ project_id: projectId });
            const matchedResult = await saveCostDataBatch(
              matchedItems,
              allExcelItems, // Add allExcelItems as the second argument
              projectName, // projectName is the third argument
              kafkaSender // sendKafkaMessage is the fourth argument
            );

            return {
              excelItemsAlreadySaved: allExcelItems.length,
              matchedItemsProcessed: matchedItems.length,
              qtoElementsUpdated: matchedResult.modifiedCount || 0,
            };
          };

          // Call the helper, passing sendCostElementsToKafka
          const result = await saveFullBatchResult(
            matchedItems,
            allExcelItems,
            projectName,
            sendCostElementsToKafka // Pass the function here
          );

          // Reload unit costs from database after saving new cost data
          console.log("Reloading unit costs from database after save...");
          await loadUnitCostsFromDatabase();

          // Send success response
          ws.send(
            JSON.stringify({
              type: "save_cost_batch_full_response",
              messageId,
              status: "success",
              message: `Successfully updated ${result.matchedItemsProcessed} matched QTO elements in costElements collection (${result.excelItemsAlreadySaved} Excel items were already saved in costData during upload).`,
              result,
            })
          );
        } catch (error) {
          console.error(
            `Error saving full batch for project '${projectName}':`,
            error
          );
          // Send error response
          ws.send(
            JSON.stringify({
              type: "save_cost_batch_full_response",
              messageId,
              status: "error",
              message: `Failed to save full batch data: ${error.message}`,
            })
          );
        }
        return; // Ensure we don't fall through
      }
      // Handle direct Excel data upload (save raw Excel data without matching)
      else if (data.type === "save_excel_data") {
        const { projectName, excelItems, replaceExisting } = data.payload || {};
        const messageId = data.messageId;

        if (!projectName || !excelItems || excelItems.length === 0) {
          console.error("Invalid save_excel_data payload:", data.payload);
          ws.send(
            JSON.stringify({
              type: "save_excel_data_response",
              messageId,
              status: "error",
              message: "Invalid payload. Missing projectName or excelItems.",
            })
          );
          return;
        }

        try {
          // Connect to MongoDB and get database references
          const { costDb, qtoDb } = await connectToMongoDB();

          // Find or create the project
          let projectId;

          const qtoProject = await qtoDb.collection("projects").findOne({
            name: { $regex: new RegExp(`^${projectName}$`, "i") },
          });

          if (qtoProject) {
            projectId = qtoProject._id;
          } else {
            projectId = new ObjectId();

            await qtoDb.collection("projects").insertOne({
              _id: projectId,
              name: projectName,
              type: "BimProject",
              status: "active",
              metadata: {
                source: "cost-plugin",
                has_cost_data: true,
              },
              created_at: new Date(),
              updated_at: new Date(),
            });
          }

          if (replaceExisting) {
            // Delete existing costData if flag is true
            const deleteResult = await costDb
              .collection("costData")
              .deleteMany({
                project_id: projectId,
              });

            // --- INSERT LOGIC (when replaceExisting is true) ---
            const costDataToSave = excelItems
              .map((item, index) => {
                // Skip items with unit_cost of 0
                const unitCost = parseFloat(item.kennwert || 0) || 0;
                const totalCost =
                  parseFloat(item.totalChf || item.chf || 0) || 0; // Also get totalCost
                const ebkpCode = item.ebkp || "";

                if (!ebkpCode || (unitCost <= 0 && totalCost <= 0)) {
                  // ebkpCode must also exist
                  return null; // Return null for items to be filtered out
                }

                // Return valid items as before
                return {
                  _id: new ObjectId(),
                  project_id: projectId,
                  ebkp_code: ebkpCode,
                  category: item.bezeichnung || item.category || "",
                  level: item.level || "",
                  unit_cost: unitCost,
                  quantity: parseFloat(item.menge || 0) || 0,
                  total_cost: totalCost,
                  currency: "CHF",
                  metadata: {
                    source: "excel-import",
                    timestamp: new Date(),
                    original_data: {
                      einheit: item.einheit || "m²",
                      kommentar: item.kommentar || "",
                      is_parent: !!(item.children && item.children.length > 0),
                    },
                  },
                  created_at: new Date(),
                  updated_at: new Date(),
                };
              })
              .filter((item) => item !== null); // Filter out null items

            let insertedCount = 0;
            if (costDataToSave.length > 0) {
              const costDataResult = await costDb
                .collection("costData")
                .insertMany(costDataToSave);
              insertedCount = costDataResult.insertedCount;
            } else {
              console.log("No valid Excel items to insert (replace mode).");
            }
            // Send success response for replace mode
            ws.send(
              JSON.stringify({
                type: "save_excel_data_response",
                messageId,
                status: "success",
                message: `Successfully replaced data with ${insertedCount} Excel items.`, // Updated message
                insertedCount: insertedCount,
              })
            );
          } else {
            // --- UPDATE/UPSERT LOGIC (when replaceExisting is false) ---
            const bulkOps = excelItems
              .map((item) => {
                // Skip items with zero unit cost
                const unitCost = parseFloat(item.kennwert || 0) || 0;
                const totalCost =
                  parseFloat(item.totalChf || item.chf || 0) || 0; // Also get totalCost
                const ebkpCode = item.ebkp || "";

                // CRITICAL CHANGE: Include items with EITHER unit cost OR total cost
                if (!ebkpCode || (unitCost <= 0 && totalCost <= 0)) {
                  // ebkpCode must also exist
                  return null;
                }

                // Define the update document
                const updateDoc = {
                  project_id: projectId,
                  ebkp_code: ebkpCode,
                  category: item.bezeichnung || item.category || "",
                  level: item.level || "",
                  unit_cost: unitCost,
                  quantity: parseFloat(item.menge || 0) || 0,
                  total_cost: totalCost,
                  currency: "CHF",
                  metadata: {
                    source: "excel-import",
                    timestamp: new Date(),
                    original_data: {
                      einheit: item.einheit || "m²",
                      kommentar: item.kommentar || "",
                      is_parent: !!(item.children && item.children.length > 0),
                    },
                  },
                  updated_at: new Date(),
                };

                // Return the bulk operation object
                return {
                  updateOne: {
                    filter: { project_id: projectId, ebkp_code: ebkpCode }, // Match by project and EBKP code
                    update: {
                      $set: updateDoc, // Set all fields
                      $setOnInsert: { created_at: new Date() }, // Set created_at only on insert
                    },
                    upsert: true, // Insert if no match is found
                  },
                };
              })
              .filter((op) => op !== null); // Filter out skipped items

            let upsertedCount = 0;
            let modifiedCount = 0;
            if (bulkOps.length > 0) {
              const bulkResult = await costDb
                .collection("costData")
                .bulkWrite(bulkOps);
              upsertedCount = bulkResult.upsertedCount;
              modifiedCount = bulkResult.modifiedCount;
            } else {
              console.log("No valid Excel items to upsert (update mode).");
            }

            // Send success response for update/upsert mode
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                type: "save_excel_data_response",
                messageId,
                status: "success",
                message: `Successfully updated/inserted ${
                  upsertedCount + modifiedCount
                } Excel items.`, // Updated message
                insertedCount: upsertedCount, // Report how many new ones were added
                updatedCount: modifiedCount, // Report how many were updated
              })
            );
          }
        } catch (error) {
          console.error(
            `Error saving Excel data for project '${projectName}':`,
            error
          );
          // Send error response
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              type: "save_excel_data_response",
              messageId,
              status: "error",
              message: `Failed to save Excel data: ${error.message}`,
            })
          );
        }
      } else if (data.type === "ping") {
        console.log(`Received ping from client ${clientId}, sending pong`);
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (error) {
      console.error(`Error processing message from client ${clientId}:`, error);
    }
  });

  // Handle client disconnection
  ws.on("close", () => {
    console.log(
      `Client ${clientId} disconnected: code=${ws.closeCode}, reason=${ws.closeReason}`
    );
    clients.delete(clientId);
    console.log(`Remaining clients: ${clients.size}`);
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error);
  });
});

// Function to broadcast messages to all connected clients
function broadcast(message) {
  let sentCount = 0;
  let errorCount = 0;
  let closedCount = 0;

  clients.forEach((client, clientId) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        sentCount++;
      } catch (error) {
        console.error(
          `Error broadcasting to client ${clientId}:`,
          error.message
        );
        errorCount++;
      }
    } else if (
      client.readyState === WebSocket.CLOSED ||
      client.readyState === WebSocket.CLOSING
    ) {
      // Clean up clients that are already closed
      clients.delete(clientId);
      closedCount++;
    }
  });

  if (clients.size > 0 || closedCount > 0) {
    console.log(
      `Broadcast complete: ${sentCount} clients received, ${errorCount} errors, ${closedCount} closed connections removed`
    );
  }
}

// Check if Kafka topic exists or create it
async function ensureTopicExists(topic) {
  try {
    // Don't connect the admin client here, just use the existing connection
    // when this is called from run()

    // List existing topics
    const topics = await admin.listTopics();

    // If topic doesn't exist, create it
    if (!topics.includes(topic)) {
      await admin.createTopics({
        topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
      });
    }

    return true;
  } catch (error) {
    console.error(`Error checking/creating Kafka topic: ${error.message}`);
    return false;
  }
  // Don't disconnect admin here, let the caller manage the connection
}

// Start Kafka consumer and connect to WebSocket
async function run() {
  let adminConnected = false;
  try {
    // 1. Connect Admin ONCE and create both topics
    await admin.connect();
    adminConnected = true;
    console.log(`Connected to Kafka admin on broker: ${config.kafka.broker}`);

    // Create both topics in a single admin session
    const topics = await admin.listTopics();
    const topicsToCreate = [];

    if (!topics.includes(config.kafka.topic)) {
      topicsToCreate.push({
        topic: config.kafka.topic,
        numPartitions: 1,
        replicationFactor: 1,
      });
    }

    if (!topics.includes(config.kafka.costTopic)) {
      topicsToCreate.push({
        topic: config.kafka.costTopic,
        numPartitions: 1,
        replicationFactor: 1,
      });
    }

    if (topicsToCreate.length > 0) {
      await admin.createTopics({ topics: topicsToCreate });
      console.log(
        `Created Kafka topics: ${topicsToCreate.map((t) => t.topic).join(", ")}`
      );
    }

    // Disconnect admin when done with topic creation
    await admin.disconnect();
    adminConnected = false;

    // 2. Connect Cost Producer
    await costProducer.connect();
    costProducerConnected = true; // Set state on success

    // 3. Connect and Run Consumer
    await consumer.connect();
    isKafkaConnected = true; // Set general Kafka connection flag

    // Broadcast Kafka connection status to all clients
    broadcast(JSON.stringify({ type: "kafka_status", status: "CONNECTED" }));

    await consumer.subscribe({
      topic: config.kafka.topic,
      fromBeginning: false, // Set to true if you need to process old messages on restart
    });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const messageValue = message.value?.toString();
          if (messageValue) {
            let messageData;
            try {
              // Attempt to parse the message
              messageData = JSON.parse(messageValue);
            } catch (parseError) {
              // Handle JSON parsing errors specifically
              console.error(
                "Error parsing Kafka message JSON:",
                parseError,
                "Raw value:",
                messageValue.substring(0, 500) + "..." // Log truncated raw value
              );
              // Skip further processing for this message if parsing failed
              return;
            }

            // --- Start processing logic (only runs if JSON parsing succeeded) ---

            // Handle PROJECT_UPDATED notification
            if (messageData.eventType === "PROJECT_UPDATED") {
              const { projectId, projectName, filename, timestamp, fileId } =
                messageData.payload || {}; // Added default empty object

              if (projectId && projectName) {
                // Check essential fields

                // Store/Update metadata
                projectMetadataStore[projectId] = {
                  project: projectName,
                  filename: filename || "unknown.ifc",
                  timestamp: timestamp || new Date().toISOString(), // Use provided or current timestamp
                  fileId: fileId || projectId,
                };

                // Trigger cost summary update
                await updateProjectCostSummary(projectId);
              } else {
                console.warn(
                  "Received PROJECT_UPDATED message with missing projectId or projectName",
                  messageData.payload
                );
              }
            } 
            // Handle individual QTO element messages from QTO backend
            else if (messageData.project && messageData.filename && messageData.data && Array.isArray(messageData.data)) {
              // This is a QTO element batch message from the QTO backend
              console.log(`Received QTO elements batch for project: ${messageData.project}`);
              console.log(`Elements count: ${messageData.data.length}`);
              
              // Store project metadata
              const projectMetadata = {
                project: messageData.project,
                filename: messageData.filename,
                timestamp: messageData.timestamp || new Date().toISOString(),
                fileId: messageData.fileId || messageData.project,
              };
              
              // Store metadata for future use
              projectMetadataStore[messageData.project] = projectMetadata;
              
              // Process each element for cost calculation
              const elementsForCostCalculation = messageData.data.map(element => ({
                id: element.global_id || element.id, // Use global_id as the main ID
                element_id: element.global_id || element.id,
                global_id: element.global_id,
                name: element.name,
                type_name: element.type_name,
                quantity: element.quantity,
                is_manual: element.is_manual,
                project_id: element.project_id,
                project: messageData.project,
                filename: messageData.filename,
                timestamp: messageData.timestamp
              }));
              
              console.log(`Processing ${elementsForCostCalculation.length} elements for cost calculation`);
              
              // Process elements in batches for cost calculation
              const BATCH_SIZE = 100;
              const allCalculatedElements = [];
              
              for (let i = 0; i < elementsForCostCalculation.length; i += BATCH_SIZE) {
                const batch = elementsForCostCalculation.slice(i, i + BATCH_SIZE);
                
                try {
                  // Process batch for cost calculation - this calculates the costs
                  const costMatches = await batchProcessCodeMatches(batch, unitCostsByEbkph, false);
                  
                  // Convert cost matches to elements with calculated costs
                  const elementsWithCosts = batch.map(element => {
                    // Find the cost match for this element
                    let calculatedCost = 0;
                    let calculatedCostUnit = 0;
                    
                    // Try to find EBKP code from element
                    let elementEbkpCode = null;
                    if (element.properties?.classification?.id) {
                      elementEbkpCode = element.properties.classification.id;
                    } else if (element.properties?.ebkph) {
                      elementEbkpCode = element.properties.ebkph;
                    } else if (element.ebkph) {
                      elementEbkpCode = element.ebkph;
                    } else if (element.ebkp_code) {
                      elementEbkpCode = element.ebkp_code;
                    } else if (element.ebkp) {
                      elementEbkpCode = element.ebkp;
                    }
                    
                    // DEBUG: Log element structure for first few elements
                    if (i < 3) {
                      console.log(`DEBUG Element ${element.id}:`, {
                        id: element.id,
                        global_id: element.global_id,
                        elementEbkpCode,
                        properties: element.properties,
                        quantity: element.quantity,
                        availableKeys: Object.keys(element)
                      });
                    }
                    
                    if (elementEbkpCode) {
                      const normalizedElementCode = normalizeEbkpCode(elementEbkpCode);
                      
                      // DEBUG: Log code matching for first few elements
                      if (i < 3) {
                        console.log(`DEBUG Code matching for element ${element.id}:`, {
                          originalCode: elementEbkpCode,
                          normalizedCode: normalizedElementCode,
                          availableUnitCosts: Object.keys(unitCostsByEbkph),
                          unitCostForThisCode: unitCostsByEbkph[normalizedElementCode]
                        });
                      }
                      
                      const match = costMatches.find(m => 
                        normalizeEbkpCode(m.excelCode) === normalizedElementCode
                      );
                      
                      if (match) {
                        calculatedCostUnit = match.unitCost || 0;
                        const quantity = parseFloat(element.quantity || 1);
                        calculatedCost = calculatedCostUnit * quantity;
                      } else {
                        // Try direct lookup in unitCostsByEbkph
                        const directMatch = unitCostsByEbkph[normalizedElementCode];
                        if (directMatch) {
                          calculatedCostUnit = directMatch.cost_unit || 0;
                          const quantity = parseFloat(element.quantity || 1);
                          calculatedCost = calculatedCostUnit * quantity;
                          
                          if (i < 3) {
                            console.log(`DEBUG Direct match found for ${element.id}:`, {
                              code: normalizedElementCode,
                              unitCost: calculatedCostUnit,
                              quantity,
                              totalCost: calculatedCost
                            });
                          }
                        }
                      }
                    } else {
                      // DEBUG: Log elements without EBKP codes
                      if (i < 10) {
                        console.log(`DEBUG Element ${element.id} has no EBKP code:`, {
                          id: element.id,
                          type_name: element.type_name,
                          name: element.name,
                          availableProperties: element.properties ? Object.keys(element.properties) : 'no properties'
                        });
                      }
                    }
                    
                    return {
                      id: element.global_id || element.id,
                      element_id: element.global_id || element.id,
                      cost: calculatedCost,
                      cost_unit: calculatedCostUnit,
                      project: element.project,
                      filename: element.filename,
                      timestamp: element.timestamp
                    };
                  });
                  
                  allCalculatedElements.push(...elementsWithCosts);
                  
                  // Small delay between batches to prevent overwhelming the system
                  if (i + BATCH_SIZE < elementsForCostCalculation.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }
                } catch (error) {
                  console.error(`Error processing batch ${i}-${i + BATCH_SIZE}:`, error);
                }
              }
              
              // Now send all calculated elements to Kafka
              if (allCalculatedElements.length > 0) {
                console.log(`Sending ${allCalculatedElements.length} calculated cost elements to Kafka`);
                
                try {
                  const kafkaResult = await sendBatchElementsToKafka(
                    allCalculatedElements,
                    projectMetadata
                  );
                  
                  if (kafkaResult) {
                    console.log(`✅ Successfully sent ${allCalculatedElements.length} cost elements to Kafka for project: ${messageData.project}`);
                  } else {
                    console.error(`❌ Failed to send cost elements to Kafka for project: ${messageData.project}`);
                  }
                } catch (kafkaError) {
                  console.error("Error sending cost elements to Kafka:", kafkaError);
                }
              }
              
              console.log(`Completed cost calculation for ${elementsForCostCalculation.length} elements from project: ${messageData.project}`);
              
              // Broadcast update to connected clients
              broadcast(JSON.stringify({
                type: "qto_elements_processed",
                project: messageData.project,
                elementCount: elementsForCostCalculation.length,
                timestamp: new Date().toISOString()
              }));
            } else {
              // Handle other message types if needed
              // Optionally forward original message: broadcast(messageValue);
              console.log("Received unknown message type:", Object.keys(messageData));
            }
            // --- End processing logic ---
          } else {
            console.log(`Received empty message from Kafka topic ${topic}.`);
          }
        } catch (processingError) {
          // Catch any errors that occur *during* the processing logic (after successful parsing)
          console.error(
            "Error processing Kafka message content:",
            processingError
          );
        }
      }, // End of eachMessage
    });
    console.log("Kafka consumer is running.");
  } catch (error) {
    console.error("Error during Kafka startup:", error);
    // Update connection states on error
    isKafkaConnected = false;
    if (!costProducer.isConnected()) {
      // Check if cost producer specifically failed
      costProducerConnected = false;
    }

    // Disconnect admin if it was left connected due to error before ensureTopicExists
    if (adminConnected) {
      try {
        await admin.disconnect();
      } catch (e) {
        console.error("Error disconnecting admin during cleanup:", e);
      }
    }

    // Broadcast Kafka connection status
    broadcast(
      JSON.stringify({
        type: "kafka_status",
        status: "DISCONNECTED",
        error: error.message,
        costProducerStatus: costProducerConnected
          ? "CONNECTED"
          : "DISCONNECTED", // Include cost producer status
      })
    );
  }
}

// Generate a sample message for testing
function generateTestMessage() {
  const timestamp = new Date().toISOString();
  // Create a sample element that matches the expected IFC element format
  return {
    project: "Test Project",
    filename: "test.ifc",
    timestamp: timestamp,
    file_id: `test.ifc_${timestamp}`,
    element_id: "test_element_1",
    category: "ifcwallstandardcase",
    level: "Level_1",
    area: 8.5,
    is_structural: true,
    is_external: false,
    ebkph: "C2.1",
    materials: [
      {
        name: "Concrete",
        fraction: 0.8,
        volume: 20,
      },
    ],
    classification: {
      id: "C2.1",
      name: "Innenwand",
      system: "EBKP",
    },
  };
}

// Send a test message if WebSocket is connected but Kafka is not
function sendTestMessage() {
  if (clients.size > 0 && !isKafkaConnected) {
    console.log("Sending test message to clients...");
    broadcast(JSON.stringify(generateTestMessage()));
  }

  // Schedule next test message
  setTimeout(sendTestMessage, 15000); // Every 15 seconds
}

// Define the new CostData interface (as comments for JS context)
/*
interface CostData {
    id: string; // Original element ID
    cost: number;
    cost_unit: number;
}
interface IfcFileData {
    project: string;
    filename: string;
    timestamp: string; // Original timestamp
    fileId: string;   // Original file ID
    data?: CostData[]; // Array of cost data
}
*/

// Modify sendEnhancedElementToKafka (and implicitly sendBatchElementsToKafka/sendCostElementsToKafka)
// This function needs the original metadata. Let's assume it's passed or retrieved.
async function sendEnhancedElementToKafka(
  enhancedElement,
  originalMetadata = null // Removed sequence parameter
) {
  // Check if producer was connected at startup
  if (!costProducerConnected) {
    console.warn(
      `Cost producer not connected (state check). Cannot send element ${enhancedElement.element_id}.`
    );
    return false; // Indicate failure
  }

  // Ensure key properties exist
  const projectId = enhancedElement.project_id || originalMetadata?.project_id;

  if (!projectId) {
    console.error(
      `Cannot send Cost data to Kafka: Project ID not found for element ${enhancedElement.element_id}`
    );
    return false; // Indicate failure
  }

  // Get the original project metadata
  const meta = originalMetadata || projectMetadataStore[projectId];

  if (!meta) {
    console.error(
      `Cannot send Cost data to Kafka: Metadata not found for element ${enhancedElement.element_id} (Project ID: ${projectId})`
    );
    // Attempt fallback to get from element if available
    if (
      !enhancedElement.project ||
      !enhancedElement.filename ||
      !enhancedElement.timestamp
    ) {
      console.warn(
        `Element ${enhancedElement.element_id} missing project/filename/timestamp for fallback.`
      );
      return false;
    }
    // Use element data as fallback metadata (less ideal)
    meta = {
      project: enhancedElement.project,
      filename: enhancedElement.filename,
      timestamp: enhancedElement.timestamp || new Date().toISOString(), // Use element timestamp or current if missing
      fileId: enhancedElement.fileId || projectId || enhancedElement.id, // Fallback fileId
    };
    console.warn(
      `Using fallback metadata from element ${enhancedElement.element_id}`
    );
  }

  // REMOVED: The check for costProducer.isConnected() is removed. We trust the startup state.
  // if (!costProducer.isConnected()) {
  //   console.error("Cost producer is not connected. Cannot send message.");
  //   return false;
  // }

  // Create the CostData payload item
  const costDataItem /* : CostData */ = {
    id: enhancedElement.element_id || enhancedElement.id,
    cost: enhancedElement.cost || 0, // Default to 0 if missing
    cost_unit: enhancedElement.cost_unit || 0, // Default to 0 if missing
  };

  // Create the standardized IfcFileData message
  const costMessage /* : IfcFileData */ = {
    project: meta.project,
    filename: meta.filename,
    timestamp: meta.timestamp,
    fileId: meta.fileId,
    data: [costDataItem],
  };

  const messageKey = meta.fileId;

  try {
    await costProducer.send({
      topic: config.kafka.costTopic,
      messages: [{ value: JSON.stringify(costMessage), key: messageKey }],
    });

    return true;
  } catch (sendError) {
    console.error("Error sending cost message to Kafka:", sendError);
    // Optional: Consider setting costProducerConnected = false here if the error indicates a persistent disconnection
    // if (isFatalKafkaError(sendError)) { costProducerConnected = false; }
    return false;
  }
}

// Modify sendBatchElementsToKafka to use the new format and pass metadata
async function sendBatchElementsToKafka(
  elements,
  project, // Note: project object might not be available, use meta instead
  filename, // Note: filename might not be available, use meta instead
  originalMetadata = null
) {
  // Check if producer was connected at startup
  if (!costProducerConnected) {
    console.warn(
      `Cost producer not connected (state check). Cannot send batch for project ${
        originalMetadata?.project || "Unknown Project" // Use metadata project name
      }.`
    );
    return false; // Return simple boolean for consistency
  }

  if (!elements || elements.length === 0) {
    return false; // Nothing to send
  }

  // Retrieve metadata (logic remains the same)
  let meta = originalMetadata;
  // ... (metadata retrieval/fallback logic remains the same) ...
  if (!meta && elements.length > 0) {
    const firstElementProjectId =
      elements[0].project_id?.toString() || elements[0].projectId?.toString();
    meta = projectMetadataStore[firstElementProjectId];
    if (!meta) {
      console.error(
        `Metadata not found for project associated with batch (e.g., ${firstElementProjectId}). Cannot send batch.`
      );
      if (
        !elements[0].project ||
        !elements[0].filename ||
        !elements[0].timestamp
      ) {
        console.warn(
          `First element missing project/filename/timestamp for fallback.`
        );
        return false;
      }
      meta = {
        project: elements[0].project,
        filename: elements[0].filename,
        timestamp: elements[0].timestamp,
        fileId: elements[0].fileId || firstElementProjectId || elements[0].id,
      };
      console.warn(`Using fallback metadata from first element for batch.`);
    }
  }
  if (!meta) {
    console.error(`Still no metadata available. Cannot send batch.`);
    return false;
  }

  // REMOVED: The check for costProducer.isConnected() is removed.
  // if (!costProducer.isConnected()) {
  //   console.error("Cost producer is not connected. Cannot send batch.");
  //   return false;
  // }

  // Create CostData items (logic remains the same)
  // ...
  const costDataItems /* : CostData[] */ = elements.map((element) => ({
    id: element.element_id || element.id,
    cost: element.cost || 0, // Default to 0
    cost_unit: element.cost_unit || 0, // Default to 0
  }));

  // Create IfcFileData message (logic remains the same)
  // ...
  const costMessage /* : IfcFileData */ = {
    project: meta.project,
    filename: meta.filename,
    timestamp: meta.timestamp,
    fileId: meta.fileId,
    data: costDataItems,
  };

  const messageKey = meta.fileId;

  try {
    await costProducer.send({
      topic: config.kafka.costTopic,
      messages: [{ value: JSON.stringify(costMessage), key: messageKey }],
    });

    return true; // Indicate success
  } catch (sendError) {
    console.error("Error sending batch cost elements to Kafka:", sendError);
    // Optional: Consider setting costProducerConnected = false here
    // if (isFatalKafkaError(sendError)) { costProducerConnected = false; }
    return false; // Indicate failure
  }
}

// Update the sendCostElementsToKafka function (called from mongodb.js)
// It now accepts the verified kafkaMetadata object directly
async function sendCostElementsToKafka(elements, kafkaMetadata) {
  if (!elements || elements.length === 0) {
    return { success: false, count: 0 };
  }

  // Validate required metadata fields
  if (
    !kafkaMetadata ||
    !kafkaMetadata.project ||
    !kafkaMetadata.filename ||
    !kafkaMetadata.timestamp ||
    !kafkaMetadata.fileId
  ) {
    console.error(
      "Incomplete kafkaMetadata received in sendCostElementsToKafka. Cannot proceed.",
      kafkaMetadata
    );
    return { success: false, count: 0 };
  }

  // Process in batches using sendBatchElementsToKafka
  const BATCH_SIZE = 1000; // Increased batch size
  let totalSent = 0;
  for (let i = 0; i < elements.length; i += BATCH_SIZE) {
    const batch = elements.slice(i, i + BATCH_SIZE);
    // Pass the batch and the verified metadata object
    const success = await sendBatchElementsToKafka(batch, kafkaMetadata);
    if (success) {
      totalSent += batch.length;
    }
    // Optional delay
    if (elements.length > BATCH_SIZE * 5 && i + BATCH_SIZE < elements.length) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return { success: totalSent > 0, count: totalSent };
}

// Modify sendBatchElementsToKafka to accept elements and kafkaMetadata
async function sendBatchElementsToKafka(
  elements,
  kafkaMetadata // Expect the verified metadata object
) {
  if (!costProducerConnected) {
    console.warn(
      `Cost producer not connected. Cannot send batch for project ${
        kafkaMetadata?.project || "Unknown"
      }.`
    );
    return false;
  }
  if (!elements || elements.length === 0) {
    return false;
  }

  // Validate essential fields in the kafkaMetadata object
  if (
    !kafkaMetadata ||
    !kafkaMetadata.project ||
    !kafkaMetadata.filename ||
    !kafkaMetadata.timestamp ||
    !kafkaMetadata.fileId
  ) {
    console.error(
      "Incomplete kafkaMetadata received in sendBatchElementsToKafka. Cannot send batch.",
      kafkaMetadata
    );
    return false; // Cannot proceed without essential metadata
  }

  // Add deduplication tracking
  const processedIds = new Set();
  const uniqueElements = [];

  // Create CostData items from the elements array with deduplication
  const costDataItems = elements
    .map((element, index) => {
      // Elements from mongodb.js already have the correct structure
      // with id (GUID), cost, and cost_unit fields
      const elementId = element.id || element.element_id;
      
      // Skip if no valid ID
      if (!elementId) {
        console.warn(`Element at index ${index} has no valid ID, skipping`);
        return null;
      }

      // Skip duplicate elements
      if (processedIds.has(elementId)) {
        return null;
      }

      // Track this ID to prevent duplicates
      processedIds.add(elementId);

      // Only log critical debugging info for first few elements
      if (index < 3) {
        console.log(`Sending cost element ${index}: ID=${elementId} (GUID), cost=${element.cost}, unit=${element.cost_unit}`);
      }

      // Use the values directly from the element as they're already calculated
      return {
        id: elementId,
        cost: typeof element.cost === "string" ? parseFloat(element.cost) : element.cost || 0,
        cost_unit: typeof element.cost_unit === "string" ? parseFloat(element.cost_unit) : element.cost_unit || 0,
      };
    })
    .filter((item) => item !== null); // Filter out nulls

  // Summarize cost data more concisely
  const nonZeroCostItems = costDataItems.filter((item) => item.cost > 0);
  const totalCost = nonZeroCostItems.reduce((sum, item) => sum + item.cost, 0);

  // Create IfcFileData message using the verified kafkaMetadata
  const costMessage = {
    project: kafkaMetadata.project,
    filename: kafkaMetadata.filename,
    timestamp: new Date(kafkaMetadata.timestamp).toISOString(), // Ensure ISO format
    fileId: kafkaMetadata.fileId,
    data: costDataItems,
  };

  const messageKey = kafkaMetadata.fileId;

  try {
    // Send to Kafka with less verbose logging
    await costProducer.send({
      topic: config.kafka.costTopic,
      messages: [{ value: JSON.stringify(costMessage), key: messageKey }],
    });
    return true;
  } catch (sendError) {
    console.error("Error sending batch cost elements to Kafka:", sendError);
    return false;
  }
}

// Handle server shutdown
const shutdown = async () => {
  // Clear intervals
  clearInterval(heartbeatInterval);

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    client.close();
  });

  // Disconnect Kafka consumer and producers
  try {
    if (consumer.isRunning) {
      await consumer.disconnect();
    }

    if (producer.isConnected) {
      await producer.disconnect();
    }

    if (costProducer.isConnected) {
      await costProducer.disconnect();
    }
  } catch (error) {
    console.error("Error disconnecting Kafka clients:", error);
  }

  // Close HTTP server
  server.close();

  process.exit(0);
};

// Handle process termination
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start the server
server.listen(config.websocket.port, async () => {
  console.log(`WebSocket server started on port ${config.websocket.port}`);

  try {
    // Load elements from MongoDB immediately
    console.log("Loading initial elements from QTO DB after server start...");
    // Call the new function to load elements right after connecting DB
    await loadInitialElementsFromQtoDb();
    
    // Load unit costs from database into memory
    console.log("Loading unit costs from database...");
    await loadUnitCostsFromDatabase();
  } catch (error) {
    console.error("Error loading elements from MongoDB:", error);
  }

  // Start the Kafka connection and ensure topics exist - single initialization point
  try {
    await run();
    console.log("Kafka initialization complete");
  } catch (err) {
    console.error("Error during Kafka initialization:", err);

    // Try to connect just the producer if the main init failed
    if (!costProducerConnected) {
      try {
        await costProducer.connect();
        costProducerConnected = true;
        console.log("Cost producer connected to Kafka");
      } catch (producerErr) {
        console.error("Error connecting cost producer:", producerErr);
      }
    }
  }

  // Start sending test messages if Kafka is not available
  setTimeout(sendTestMessage, 10000); // Start after 10 seconds
});

// Normalize EBKPH code (used for matching)
function normalizeEbkpCode(code) {
  if (!code) return code;

  console.log(`DEBUG: Normalizing code: "${code}"`);

  // Convert to uppercase for consistent matching
  const upperCode = code.toUpperCase().trim();

  // Remove any spaces
  let normalized = upperCode.replace(/\s+/g, "");

  // First try the format with dots
  normalized = normalized.replace(/([A-Z])0*(\d+)\.0*(\d+)/g, "$1$2.$3");

  // Then handle codes without dots
  normalized = normalized.replace(/([A-Z])0*(\d+)$/g, "$1$2");

  // Handle special case "C.1" format (missing number after letter)
  normalized = normalized.replace(/([A-Z])\.(\d+)/g, "$1$2");

  return normalized;
}

// Add a helper function to send element updates to all clients
function broadcastElementUpdate() {
  const elementInfo = {
    type: "element_update",
    elementCount: processedElementIds.size,
    ebkphCodes:
      Object.keys(ifcElementsByEbkph).length > 20
        ? Object.keys(ifcElementsByEbkph).length + " codes available"
        : Object.keys(ifcElementsByEbkph),
    projects: Object.keys(elementsByProject),
    costCodes:
      Object.keys(unitCostsByEbkph).length > 20
        ? Object.keys(unitCostsByEbkph).length + " codes available"
        : Object.keys(unitCostsByEbkph),
    timestamp: new Date().toISOString(),
  };

  broadcast(JSON.stringify(elementInfo));
}

// Add a function to broadcast cost match information for a single code
function broadcastCostMatch(ebkpCode, costUnit, elementCount) {
  const matchInfo = {
    type: "cost_match_info",
    matches: {
      [ebkpCode]: {
        elementCount,
        costUnit,
      },
    },
    matchCount: 1,
    elementCount: elementCount,
    timestamp: new Date().toISOString(),
  };

  broadcast(JSON.stringify(matchInfo));
}

// Add this function to find the best match for an EBKP code
function findBestEbkphMatch(normalizedCode) {
  if (!normalizedCode) return null;

  // First, direct match
  if (unitCostsByEbkph[normalizedCode]) {
    return {
      code: normalizedCode,
      costInfo: unitCostsByEbkph[normalizedCode],
      method: "direct",
    };
  }

  // Next, try removing all non-alphanumeric characters
  const cleanedCode = normalizedCode.replace(/[^A-Z0-9]/g, "");
  for (const [costCode, costInfo] of Object.entries(unitCostsByEbkph)) {
    const cleanedCostCode = costCode.replace(/[^A-Z0-9]/g, "");
    if (cleanedCostCode === cleanedCode) {
      return {
        code: costCode,
        costInfo,
        method: "simplified",
      };
    }
  }

  // Try to match just the major segments (like C2 part of C2.1)
  const majorSegmentMatch = normalizedCode.match(/^([A-Z]\d+)/);
  if (majorSegmentMatch && majorSegmentMatch[1]) {
    const majorSegment = majorSegmentMatch[1];

    for (const [costCode, costInfo] of Object.entries(unitCostsByEbkph)) {
      if (
        costCode.startsWith(majorSegment + ".") ||
        costCode === majorSegment
      ) {
        return {
          code: costCode,
          costInfo,
          method: "major-segment",
        };
      }
    }
  }

  return null;
}

// Add a function to batch process code matches
async function batchProcessCodeMatches(
  elements,
  unitCosts,
  forceRefresh = false
) {
  // Return cached matches if they exist and are not expired
  if (!forceRefresh && cachedMatches && lastMatchTimestamp) {
    const age = Date.now() - lastMatchTimestamp;
    if (age < MATCH_CACHE_DURATION) {
      console.log("Returning cached matches");
      return cachedMatches;
    }
  }

  // Quick check if both arrays are empty
  if (elements.length === 0 || Object.keys(unitCosts).length === 0) {
    return [];
  }

  const matches = [];
  const processedCodes = new Set();

  // Create a map of normalized codes for faster lookup
  const normalizedCostCodes = new Map();
  Object.entries(unitCosts).forEach(([code, costInfo]) => {
    const normalizedCode = normalizeEbkpCode(code);
    normalizedCostCodes.set(normalizedCode, { code, costInfo });
  });

  // Process all elements at once
  for (const element of elements) {
    // Try different properties that might contain EBKP codes
    let ebkpCode = null;

    // First try direct properties
    if (element.properties?.classification?.id) {
      ebkpCode = element.properties.classification.id;
    } else if (element.properties?.ebkph) {
      ebkpCode = element.properties.ebkph;
    } else if (element.ebkph) {
      ebkpCode = element.ebkph;
    } else if (element.ebkp_code) {
      ebkpCode = element.ebkp_code;
    } else if (element.ebkp) {
      ebkpCode = element.ebkp;
    }

    if (!ebkpCode || processedCodes.has(ebkpCode)) continue;

    const normalizedCode = normalizeEbkpCode(ebkpCode);

    const match = findBestEbkphMatch(normalizedCode);

    if (match) {
      const costInfo = match.costInfo;
      const area = parseFloat(element.quantity || element.area || 0);
      const costUnit = costInfo.cost_unit || 0;
      const totalCost = costUnit * (area || 1);

      matches.push({
        code: match.code,
        excelCode: ebkpCode,
        normalizedExcelCode: normalizedCode,
        elementCount: 1,
        quantity: area,
        matchType: match.method,
        unitCost: costUnit,
        totalCost: totalCost,
        cost_source: costInfo.filename,
        cost_timestamp: costInfo.timestamp,
      });

      processedCodes.add(ebkpCode);
    }
  }

  // Cache the results
  cachedMatches = matches;
  lastMatchTimestamp = Date.now();

  return matches;
}

// Add this after the shutdown function
// Send a test cost message to Kafka for testing purposes
async function sendTestCostMessage() {
  const timestamp = new Date().toISOString();

  // Create a test element with cost data
  const testElement = {
    element_id: `test_element_${Date.now()}`,
    project: "Test Project",
    filename: "test.ifc",
    category: "ifcwallstandardcase",
    level: "Level_1",
    is_structural: true,
    fire_rating: "F30",
    ebkph: "C2.1",
    cost: 100.0,
    cost_unit: 10.0,
  };

  const result = await sendEnhancedElementToKafka(testElement);

  if (result) {
    console.log("Test cost message sent successfully");
  } else {
    console.error("Failed to send test cost message");
  }

  return result;
}

// Add back the test batch function with our new approach
async function sendTestCostBatch() {
  const project = "Test Project";
  const filename = "test.ifc";

  // Create a batch of test elements
  const testElements = [
    {
      element_id: `test_element_1`,
      project: project,
      filename: filename,
      category: "ifcwall",
      level: "Level_1",
      is_structural: true,
      fire_rating: "F30",
      ebkph: "C2.1",
      cost: 100.0,
      cost_unit: 10.0,
    },
    {
      element_id: `test_element_2`,
      project: project,
      filename: filename,
      category: "ifcwall",
      level: "Level_1",
      is_structural: false,
      fire_rating: "",
      ebkph: "C2.1",
      cost: 150.0,
      cost_unit: 15.0,
    },
    {
      element_id: `test_element_3`,
      project: project,
      filename: filename,
      category: "ifcslab",
      level: "Level_2",
      is_structural: true,
      fire_rating: "F60",
      ebkph: "C4.1",
      cost: 200.0,
      cost_unit: 20.0,
    },
  ];

  const result = await sendBatchElementsToKafka(
    testElements,
    project,
    filename
  );

  if (result) {
    console.log("Test cost batch sent successfully");
  } else {
    console.error("Failed to send test cost batch");
  }

  return result;
}

// NEW function to load initial elements
async function loadInitialElementsFromQtoDb() {
  try {
    const { qtoDb } = await connectToMongoDB(); // Ensure connection
    if (!qtoDb) {
      console.warn(
        "QTO DB connection not available, cannot load initial elements."
      );
      return;
    }

    // Clear existing in-memory data before loading
    processedElementIds.clear();
    Object.keys(ifcElementsByEbkph).forEach(
      (key) => delete ifcElementsByEbkph[key]
    );
    Object.keys(elementsByProject).forEach(
      (key) => delete elementsByProject[key]
    );

    const elements = await qtoDb.collection("elements").find({}).toArray();

    let processedCount = 0;
    elements.forEach((element) => {
      const elementId = element._id.toString();
      const ebkpCode = getElementEbkpCode(element); // Use imported helper

      if (ebkpCode) {
        const normalizedCode = normalizeEbkpCode(ebkpCode); // Normalize code
        const projectKey = element.project_name || element.project || "unknown"; // Determine project key

        // Store by normalized EBKPH code (global)
        if (!ifcElementsByEbkph[normalizedCode]) {
          ifcElementsByEbkph[normalizedCode] = [];
        }
        element.sequence = ifcElementsByEbkph[normalizedCode].length;
        ifcElementsByEbkph[normalizedCode].push(element);

        // Also store by project and normalized EBKPH code
        if (!elementsByProject[projectKey]) {
          elementsByProject[projectKey] = {};
        }
        if (!elementsByProject[projectKey][normalizedCode]) {
          elementsByProject[projectKey][normalizedCode] = [];
        }
        element.projectSequence =
          elementsByProject[projectKey][normalizedCode].length; // Add project-specific sequence too
        elementsByProject[projectKey][normalizedCode].push(element);

        processedCount++;
      }
      // Always add element ID to processed set, even if no EBKP code
      processedElementIds.add(elementId);
    });

    console.log(`Total elements tracked (by ID): ${processedElementIds.size}.`);
  } catch (error) {
    console.error("Error loading initial elements from QTO DB:", error);
  }
}
