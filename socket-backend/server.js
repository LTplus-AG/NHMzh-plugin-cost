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
  getAllElementsForProject,
  getCostDataForElement,
  saveCostData,
  saveCostDataBatch,
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

// Store IFC elements by EBKPH code
const ifcElementsByEbkph = {};

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
  // Add CORS headers to all responses
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle OPTIONS pre-flight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Simple health check endpoint
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "UP",
        kafka: consumer.isRunning ? "CONNECTED" : "DISCONNECTED",
        costProducer: costProducer.isConnected ? "CONNECTED" : "DISCONNECTED",
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

    console.log(
      `Received request for project elements by name: ${projectName}`
    );

    // Use the MongoDB helper to get elements by project name directly
    getAllElementsForProject(projectName)
      .then((elements) => {
        console.log(
          `Retrieved ${elements.length} elements for project: ${projectName}`
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(elements));
      })
      .catch((error) => {
        console.error(
          `Error getting elements for project ${projectName}:`,
          error
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Failed to get elements: ${error.message}` })
        );
      });
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

    console.log(
      `Received request for project cost data by name: ${projectName}`
    );

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
        console.log(`Found project with ID: ${projectId}`);

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
          console.log(
            `Elements found (${costSummary.elements_count}) but zero cost - verifying...`
          );

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

        console.log("Received cost update request:", data);

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

          console.log("Cost update sent to Kafka:", message.key);

          // Update internal elements mapping if project is loaded
          const projectName = payload.projectName;

          // Try to get actual ID if we don't have it
          let projectId = payload.projectId;
          if (!projectId && config.mongodb.enabled) {
            // Try to look up project ID from elements if we don't have it
            try {
              const project = await sharedDb.collection("projects").findOne({
                name: { $regex: new RegExp(`^${projectName}$`, "i") },
              });

              if (project) {
                projectId = project._id.toString();
                console.log(
                  `Found project ID for ${projectName}: ${projectId}`
                );
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
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
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
    console.log(`Received pong from client ${clientId}`);
    ws.isAlive = true;
  });
}

// Interval to ping clients and terminate dead connections
const heartbeatInterval = setInterval(() => {
  console.log(`Running heartbeat check for ${clients.size} clients`);

  clients.forEach((ws, clientId) => {
    if (ws.isAlive === false) {
      console.log(
        `Client ${clientId} didn't respond to ping, terminating connection`
      );
      ws.terminate();
      clients.delete(clientId);
      return;
    }

    ws.isAlive = false;
    try {
      ws.ping("", false, true);
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

  console.log(
    `New client connected: ID=${clientId}, IP=${req.socket.remoteAddress}`
  );

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
    try {
      const data = JSON.parse(message);
      console.log(`Received message from client ${clientId}:`, message);

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

        console.log(
          `Received request to delete cost data for project '${projectName}'`
        );

        try {
          // Find the project ID first
          const qtoProject = await qtoDb.collection("projects").findOne({
            name: { $regex: new RegExp(`^${projectName}$`, "i") },
          });

          if (!qtoProject) {
            // Project not found but don't treat it as an error
            console.log(`Project '${projectName}' not found for deletion`);
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

          console.log(
            `Deleted cost data for project '${projectName}': ${costDataResult.deletedCount} costData, ${costElementsResult.deletedCount} costElements, ${costSummariesResult.deletedCount} summaries`
          );

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
        console.log("Received request for available eBKP codes");

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
          console.log(
            `Sent ${allCodes.size} available eBKP codes to client with details`
          );
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
        console.log(
          `Received code matching request with ${
            data.codes?.length || 0
          } codes from client ${clientId}`
        );

        try {
          // Log input details
          if (data.codes?.length > 0) {
            console.log(
              `Sample codes: ${data.codes.slice(0, 5).join(", ")}...`
            );
          } else {
            console.log("WARNING: No codes provided in request");
          }

          // Force MongoDB load if requested
          if (data.debug?.forceMongoDB && config.mongodb.enabled) {
            console.log("DEBUG: Client requested to force MongoDB load");
            await loadElementsFromMongoDB();
            // Force refresh matches after MongoDB load
            cachedMatches = null;
            lastMatchTimestamp = null;
          }

          // Get codes from the message
          const excelCodes = data.codes || [];
          console.log(`Processing ${excelCodes.length} excel codes`);

          // Some basic validation
          if (!excelCodes.length) {
            console.log("No codes to process, sending empty response");
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
          console.log(
            `Normalized ${normalizedCodes.length} codes for matching`
          );

          try {
            // Get elements and unit costs
            const elementsList = Object.values(ifcElementsByEbkph).flat();
            console.log(
              `Processing matches using ${elementsList.length} elements and ${
                Object.keys(unitCostsByEbkph).length
              } cost codes`
            );

            // Process matches (will use cache if available)
            const matches = await batchProcessCodeMatches(
              elementsList,
              unitCostsByEbkph,
              data.debug?.forceRefresh || false
            );
            console.log(`Found ${matches.length} matches`);

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

            console.log(
              `Sending response for code matching: ${
                matches ? matches.length : 0
              } matches found`
            );
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

        console.log(
          `Received save_cost_batch for project '${projectName}' with ${costItems.length} items.`
        );

        try {
          // Call the MongoDB function to save the batch directly
          // This function already handles creating/finding the project and elements
          const result = await saveCostDataBatch(costItems, projectName);
          console.log(
            `Batch save result for project '${projectName}':`,
            result
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

        console.log(
          `Received save_cost_batch_full for project '${projectName}' with ${matchedItems.length} matched items and ${allExcelItems.length} total Excel items.`
        );

        try {
          // Create a custom handler function that will pass both matched items and all Excel items
          const saveFullBatchResult = async (
            matchedItems,
            allExcelItems,
            projectName
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
              console.log(`Found existing QTO project with ID: ${projectId}`);
            } else {
              projectId = new ObjectId();
              console.log(`Creating new project with ID: ${projectId}`);

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

            // Step 2: Delete existing costElements entries but KEEP costData entries
            // IMPORTANT: We're only updating the costElements collection here
            // The costData collection already contains the Excel data from the upload step
            console.log(
              `Deleting only costElements entries for project ${projectId}`
            );
            await costDb
              .collection("costElements")
              .deleteMany({ project_id: projectId });

            // Step 3: Skip saving Excel items to costData - we've already done this during upload
            console.log(
              `Using ${allExcelItems.length} existing Excel items from costData collection (not modifying costData)`
            );

            // Step 4: Process matched items using the existing function to update costElements
            const matchedResult = await saveCostDataBatch(
              matchedItems,
              projectName
            );
            console.log(
              `Processed ${matchedItems.length} matched items for costElements collection`
            );

            return {
              excelItemsAlreadySaved: allExcelItems.length,
              matchedItemsProcessed: matchedItems.length,
              qtoElementsUpdated: matchedResult.modifiedCount || 0,
            };
          };

          // Call our custom handler
          const result = await saveFullBatchResult(
            matchedItems,
            allExcelItems,
            projectName
          );

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

        console.log(
          `Received raw Excel data for project '${projectName}' with ${excelItems.length} items. Replace existing: ${replaceExisting}`
        );

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
            console.log(`Found existing QTO project with ID: ${projectId}`);
          } else {
            projectId = new ObjectId();
            console.log(`Creating new project with ID: ${projectId}`);

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
            console.log(
              `Deleting existing costData for project ${projectName} before saving new data`
            );
            const deleteResult = await costDb
              .collection("costData")
              .deleteMany({
                project_id: projectId,
              });
            console.log(
              `Deleted ${deleteResult.deletedCount} existing costData entries`
            );

            // --- INSERT LOGIC (when replaceExisting is true) ---
            const costDataToSave = excelItems
              .map((item, index) => {
                // Skip items with unit_cost of 0
                const unitCost = parseFloat(item.kennwert || 0) || 0;
                if (unitCost <= 0) {
                  console.log(
                    `Skipping Excel item with EBKP ${
                      item.ebkp || ""
                    } due to zero unit cost`
                  );
                  return null; // Return null for items to be filtered out
                }

                // Return valid items as before
                return {
                  _id: new ObjectId(),
                  project_id: projectId,
                  ebkp_code: item.ebkp || "",
                  category: item.bezeichnung || item.category || "",
                  level: item.level || "",
                  unit_cost: unitCost,
                  quantity: parseFloat(item.menge || 0) || 0,
                  total_cost: parseFloat(item.totalChf || item.chf || 0) || 0,
                  currency: "CHF",
                  metadata: {
                    source: "excel-import",
                    timestamp: new Date(),
                    original_data: {
                      einheit: item.einheit || "m²",
                      kommentar: item.kommentar || "",
                      // excel_row: index + 1, // Row index isn't easily available here
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
              console.log(
                `Successfully inserted ${insertedCount} Excel items into costData collection (replace mode)`
              );
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
            console.log(`Upserting costData for project ${projectName}`);
            const bulkOps = excelItems
              .map((item) => {
                // Skip items with zero unit cost
                const unitCost = parseFloat(item.kennwert || 0) || 0;
                const ebkpCode = item.ebkp || "";
                if (unitCost <= 0 || !ebkpCode) {
                  console.log(
                    `Skipping Excel item with EBKP ${ebkpCode} due to zero unit cost or missing code`
                  );
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
                  total_cost: parseFloat(item.totalChf || item.chf || 0) || 0,
                  currency: "CHF",
                  metadata: {
                    source: "excel-import",
                    timestamp: new Date(),
                    original_data: {
                      einheit: item.einheit || "m²",
                      kommentar: item.kommentar || "",
                      // excel_row: index + 1, // Row index isn't easily available here
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
              console.log(
                `Bulk write completed: ${upsertedCount} inserted, ${modifiedCount} updated (update mode)`
              );
            } else {
              console.log("No valid Excel items to upsert (update mode).");
            }

            // Send success response for update/upsert mode
            ws.send(
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
          ws.send(
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
      console.log(
        `Client ${clientId} connection is already closed, removing from client list`
      );
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
    // Connect to the admin client
    await admin.connect();

    // List existing topics
    const topics = await admin.listTopics();
    console.log(`Available Kafka topics: ${topics.join(", ")}`);

    // If topic doesn't exist, create it
    if (!topics.includes(topic)) {
      console.log(`Topic '${topic}' does not exist. Creating it...`);
      await admin.createTopics({
        topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
      });
      console.log(`Created topic: ${topic}`);
    } else {
      console.log(`Topic '${topic}' already exists`);
    }

    return true;
  } catch (error) {
    console.error(`Error checking/creating Kafka topic: ${error.message}`);
    return false;
  } finally {
    await admin.disconnect();
  }
}

// Start Kafka consumer and connect to WebSocket
async function run() {
  try {
    // Connect to Kafka broker (admin operations)
    await admin.connect();
    console.log("Connected to Kafka broker (admin): " + config.kafka.broker);

    // Initialize MongoDB connection if enabled
    if (config.mongodb.enabled) {
      try {
        await connectToMongoDB();
        console.log("MongoDB connection initialized");
      } catch (mongoError) {
        console.error(
          "MongoDB connection initialization failed:",
          mongoError.message
        );
        console.log(
          "The application will continue but MongoDB-dependent features will not work"
        );
        // Continue execution - we'll attempt to reconnect on each DB operation
      }
    }

    // Check if topics exist, create if not
    await ensureTopicExists(config.kafka.topic);
    await ensureTopicExists(config.kafka.costTopic);

    // First check Kafka connection by connecting a producer
    await producer.connect();
    console.log("Connected to Kafka broker (producer):", config.kafka.broker);

    // Disconnect producer as we don't need it anymore
    await producer.disconnect();

    // Now connect the consumer
    await consumer.connect();
    console.log("Connected to Kafka broker (consumer):", config.kafka.broker);
    isKafkaConnected = true;

    // Broadcast Kafka connection status to all clients
    broadcast(JSON.stringify({ type: "kafka_status", status: "CONNECTED" }));

    // Subscribe to topic
    await consumer.subscribe({
      topic: config.kafka.topic,
      fromBeginning: false,
    });
    console.log("Subscribed to topic:", config.kafka.topic);

    // Start consuming messages
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const messageValue = message.value?.toString();
          if (messageValue) {
            console.log(
              `Received message from Kafka topic ${topic}:`,
              messageValue.substring(0, 200) + "..."
            );

            // Parse the message data
            const messageData = JSON.parse(messageValue);

            // Check if this is a PROJECT_UPDATED notification
            if (messageData.eventType === "PROJECT_UPDATED") {
              console.log(
                `Received PROJECT_UPDATED notification for project: ${messageData.payload.projectName} (ID: ${messageData.payload.projectId})`
              );

              // Extract project information
              const projectId = messageData.payload.projectId;
              const projectName = messageData.payload.projectName;
              const elementCount = messageData.payload.elementCount;

              try {
                // Fetch all elements for this project from MongoDB
                console.log(
                  `Fetching all elements for project ${projectName} (ID: ${projectId})`
                );
                const elements = await getAllElementsForProject(projectId);
                console.log(
                  `Retrieved ${elements.length} elements for project ${projectName}`
                );

                if (elements.length > 0) {
                  // Update the project data in our in-memory storage
                  elementsByProject[projectName] = {};

                  // Process and organize elements by EBKPH code
                  elements.forEach((element) => {
                    const ebkpCode =
                      element.properties?.classification?.id ||
                      element.ebkph ||
                      "unknown";
                    const normalizedCode = normalizeEbkpCode(ebkpCode);

                    // Store by EBKPH code
                    if (!ifcElementsByEbkph[normalizedCode]) {
                      ifcElementsByEbkph[normalizedCode] = [];
                    }
                    ifcElementsByEbkph[normalizedCode].push(element);

                    // Also store by project for easier retrieval
                    if (!elementsByProject[projectName][normalizedCode]) {
                      elementsByProject[projectName][normalizedCode] = [];
                    }
                    elementsByProject[projectName][normalizedCode].push(
                      element
                    );

                    // Mark as processed to avoid duplicates
                    const elementId = element._id.toString();
                    processedElementIds.add(elementId);
                  });

                  // Calculate costs for all elements
                  let projectTotalCost = 0;
                  let elementsWithCost = 0;

                  for (const ebkpCode in elementsByProject[projectName]) {
                    const elementsWithThisCode =
                      elementsByProject[projectName][ebkpCode];

                    // Find the best match for this code
                    const bestMatch = findBestEbkphMatch(ebkpCode);

                    if (bestMatch) {
                      // Get cost information
                      const costInfo = bestMatch.costInfo;
                      const costUnit = costInfo.cost_unit || 0;

                      // Apply costs to all elements with this code
                      elementsWithThisCode.forEach((element) => {
                        const area = parseFloat(element.quantity || 0);
                        const totalCost = costUnit * (area || 1);

                        // Update element with cost data
                        element.cost_unit = costUnit;
                        element.cost = totalCost;
                        element.cost_source = costInfo.filename;
                        element.cost_timestamp = costInfo.timestamp;
                        element.cost_match_method = bestMatch.method;

                        // Update project total
                        projectTotalCost += totalCost;
                        elementsWithCost++;
                      });

                      // Broadcast cost match notification
                      broadcastCostMatch(
                        bestMatch.code,
                        costUnit,
                        elementsWithThisCode.length
                      );
                    }
                  }

                  // Update project cost summary in MongoDB
                  await updateProjectCostSummary(projectId);

                  // Broadcast project update to clients
                  const projectUpdateMessage = {
                    type: "project_update",
                    projectId: projectId,
                    projectName: projectName,
                    totalElements: elements.length,
                    elementsWithCost: elementsWithCost,
                    totalCost: projectTotalCost,
                    timestamp: new Date().toISOString(),
                    metadata: messageData.metadata,
                  };

                  console.log(
                    `Broadcasting project update for ${projectName} with total cost: ${projectTotalCost}`
                  );
                  broadcast(JSON.stringify(projectUpdateMessage));
                } else {
                  console.log(
                    `No elements found for project ${projectName} (ID: ${projectId})`
                  );
                }
              } catch (err) {
                console.error(
                  `Error processing project update for ${projectName}:`,
                  err
                );
              }
            } else {
              // Handle legacy element messages for backward compatibility
              const elementData = messageData;

              // Check if we've already processed this element
              const elementId = elementData.element_id || elementData.id;
              if (!elementId || processedElementIds.has(elementId)) {
                // Skip duplicates
                broadcast(messageValue); // Still forward the message to clients
                return;
              }

              // Store the element by EBKPH code for later use
              if (elementData.ebkph) {
                // Normalize EBKPH code
                const ebkpCode = normalizeEbkpCode(elementData.ebkph);

                // Store by EBKPH code
                if (!ifcElementsByEbkph[ebkpCode]) {
                  ifcElementsByEbkph[ebkpCode] = [];
                }
                ifcElementsByEbkph[ebkpCode].push(elementData);

                // Also store by project for easier retrieval
                const projectKey = elementData.project || "unknown";
                if (!elementsByProject[projectKey]) {
                  elementsByProject[projectKey] = {};
                }
                if (!elementsByProject[projectKey][ebkpCode]) {
                  elementsByProject[projectKey][ebkpCode] = [];
                }
                elementsByProject[projectKey][ebkpCode].push(elementData);

                // Mark as processed to avoid duplicates
                processedElementIds.add(elementId);

                console.log(
                  `Stored IFC element with EBKPH ${ebkpCode} (element ID: ${elementId})`
                );

                // Save to file periodically
                scheduleElementSave();
              }

              // If element has an EBKPH code, check if we have a unit cost for it
              if (elementData.ebkph) {
                // Normalize the code for lookup
                const normalizedCode = normalizeEbkpCode(elementData.ebkph);

                // Debug log all available cost codes for comparison
                if (Object.keys(unitCostsByEbkph).length > 0) {
                  console.log(
                    `Looking for cost data match for element EBKPH ${elementData.ebkph} (normalized: ${normalizedCode})`
                  );
                  console.log(
                    `Available cost codes: ${Object.keys(unitCostsByEbkph).join(
                      ", "
                    )}`
                  );
                }

                // Find the best match for this code
                const bestMatch = findBestEbkphMatch(normalizedCode);

                if (bestMatch) {
                  // Add cost information to the element
                  const costInfo = bestMatch.costInfo;
                  const area = parseFloat(elementData.area || 0);
                  const costUnit = costInfo.cost_unit || 0;

                  // Enhanced element with cost data - preserve original structure
                  const enhancedElement = {
                    ...elementData, // Keep all original element properties
                    cost_unit: costUnit,
                    cost: costUnit * (area || 1), // Calculate total cost
                    cost_source: costInfo.filename,
                    cost_timestamp: costInfo.timestamp,
                    cost_match_method: bestMatch.method,
                  };

                  // Make sure EBKPH components are present
                  if (costInfo.ebkph1 && !enhancedElement.ebkph1) {
                    enhancedElement.ebkph1 = costInfo.ebkph1;
                  }
                  if (costInfo.ebkph2 && !enhancedElement.ebkph2) {
                    enhancedElement.ebkph2 = costInfo.ebkph2;
                  }
                  if (costInfo.ebkph3 && !enhancedElement.ebkph3) {
                    enhancedElement.ebkph3 = costInfo.ebkph3;
                  }

                  console.log(
                    `MATCH FOUND (${bestMatch.method}): Added cost data to element with EBKPH ${elementData.ebkph} (normalized: ${normalizedCode}): unit cost = ${costUnit}, area = ${area}, total cost = ${enhancedElement.cost}`
                  );

                  // Send enhanced element to cost topic
                  await sendEnhancedElementToKafka(enhancedElement);

                  // Also notify clients about this match
                  broadcastCostMatch(bestMatch.code, costUnit, 1);
                } else {
                  console.log(
                    `No cost data found for EBKPH code ${elementData.ebkph} (normalized: ${normalizedCode})`
                  );
                }
              }

              // Forward original message to all connected WebSocket clients
              broadcast(messageValue);
            }
          }
        } catch (err) {
          console.error("Error processing message:", err);
        }
      },
    });
  } catch (error) {
    console.error("Error running Kafka consumer:", error);
    isKafkaConnected = false;

    // Broadcast Kafka connection status to all clients
    broadcast(
      JSON.stringify({
        type: "kafka_status",
        status: "DISCONNECTED",
        error: error.message,
      })
    );

    // Try to reconnect after a delay
    setTimeout(() => {
      console.log("Attempting to reconnect to Kafka...");
      run();
    }, 5000);
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

// Send enhanced element with cost data to Kafka
async function sendEnhancedElementToKafka(enhancedElement) {
  try {
    // Make sure cost topic exists
    if (!costTopicReady) {
      console.log(`Ensuring cost topic exists: ${config.kafka.costTopic}`);
      costTopicReady = await ensureTopicExists(config.kafka.costTopic);
    }

    // Make sure cost producer is connected
    if (!costProducer.isConnected) {
      console.log("Connecting cost producer to Kafka...");
      await costProducer.connect();
      console.log("Cost producer connected to Kafka");
    }

    // Log what we're sending to help with debugging
    console.log("Sending element to cost topic with structure:", {
      id: enhancedElement.element_id || enhancedElement.id,
      category: enhancedElement.category,
      level: enhancedElement.level,
      ebkph: enhancedElement.ebkph,
      area: enhancedElement.area,
      cost_unit: enhancedElement.cost_unit,
      cost: enhancedElement.cost,
    });

    // Send the enhanced element to Kafka
    const result = await costProducer.send({
      topic: config.kafka.costTopic,
      messages: [
        {
          value: JSON.stringify(enhancedElement),
          key: enhancedElement.element_id || enhancedElement.id,
        },
      ],
    });

    console.log(
      `Enhanced element sent to Kafka topic ${config.kafka.costTopic}`
    );
    return true;
  } catch (error) {
    console.error("Error sending enhanced element to Kafka:", error);
    return false;
  }
}

// Flag to track if cost topic is ready
let costTopicReady = false;

// Handle server shutdown
const shutdown = async () => {
  console.log("Shutting down...");

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
      console.log("Kafka consumer disconnected");
    }

    if (producer.isConnected) {
      await producer.disconnect();
      console.log("Kafka producer disconnected");
    }

    if (costProducer.isConnected) {
      await costProducer.disconnect();
      console.log("Cost producer disconnected");
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
    console.log("Loading elements from MongoDB...");
    const db = await connectToMongoDB();

    if (!db || !db.qtoDb) {
      console.error("Failed to connect to MongoDB or get qtoDb reference");
    } else {
      // Query all elements
      const elements = await db.qtoDb.collection("elements").find({}).toArray();
      console.log(`Found ${elements.length} elements in MongoDB`);

      // Clear existing data
      Object.keys(ifcElementsByEbkph).forEach(
        (key) => delete ifcElementsByEbkph[key]
      );
      processedElementIds.clear();

      // Process elements
      let processedCount = 0;
      for (const element of elements) {
        // Try to extract eBKP code from various locations
        let ebkpCode = null;

        // Check in properties.classification.id first (most common MongoDB format)
        if (element.properties?.classification?.id) {
          ebkpCode = element.properties.classification.id;
        }
        // Then try properties.ebkph
        else if (element.properties?.ebkph) {
          ebkpCode = element.properties.ebkph;
        }
        // Finally, check root level properties
        else if (element.ebkph) {
          ebkpCode = element.ebkph;
        } else if (element.ebkp_code) {
          ebkpCode = element.ebkp_code;
        }

        if (ebkpCode) {
          // Normalize code for consistent matching
          const normalizedCode = normalizeEbkpCode(ebkpCode);

          // Store element by normalized code
          if (!ifcElementsByEbkph[normalizedCode]) {
            ifcElementsByEbkph[normalizedCode] = [];
          }

          // Get quantity from root level
          const quantity = element.quantity || 0;

          // Store element with quantity as area
          ifcElementsByEbkph[normalizedCode].push({
            ...element,
            area: quantity, // Use quantity as area
            quantity: quantity, // Keep original quantity
          });
          processedCount++;

          // Mark as processed to avoid duplicates
          processedElementIds.add(element._id.toString());
        }
      }

      console.log(
        `Successfully loaded ${processedCount} elements from MongoDB with eBKP codes`
      );
      console.log(`Available eBKP codes:`, Object.keys(ifcElementsByEbkph));

      // Print QTO element codes summary
      // await printAllQtoElementCodes(); // Function not defined
    }
  } catch (error) {
    console.error("Error loading elements from MongoDB:", error);
  }

  // Start the Kafka connection and ensure topics exist
  run().catch(console.error);

  // Ensure the cost topic exists and connect cost producer
  ensureTopicExists(config.kafka.costTopic)
    .then(() => {
      return costProducer.connect();
    })
    .then(() => console.log("Cost producer connected to Kafka"))
    .catch((err) => console.error("Error connecting cost producer:", err));

  // Start sending test messages if Kafka is not available
  setTimeout(sendTestMessage, 10000); // Start after 10 seconds

  // Set up periodic save
  // setInterval(() => {
  //   saveElementsToFile(); // Function not defined
  // }, config.storage.saveInterval);
});

// Normalize EBKPH code (used for matching)
function normalizeEbkpCode(code) {
  if (!code) return code;

  console.log(`DEBUG: Normalizing code: "${code}"`);

  // Convert to uppercase for consistent matching
  const upperCode = code.toUpperCase().trim();

  // Special case handling for common variations
  // Handle patterns like:
  // "C01.01" becomes "C1.1"
  // "C1.1" remains "C1.1"
  // "C01.1" becomes "C1.1"
  // "C1.01" becomes "C1.1"
  // "C01" becomes "C1"
  // "C 1" becomes "C1"
  // "C 1.1" becomes "C1.1"

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
  console.log(
    `Broadcast element update: ${processedElementIds.size} elements available`
  );
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
  console.log(
    `Broadcast cost match for code ${ebkpCode}: ${elementCount} element(s), unit cost = ${costUnit}`
  );
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

  console.log(
    `Processing new matches with ${elements.length} elements and ${
      Object.keys(unitCosts).length
    } unit costs`
  );

  // Quick check if both arrays are empty
  if (elements.length === 0 || Object.keys(unitCosts).length === 0) {
    console.log(
      "Either elements or unit costs are empty, returning empty array"
    );
    return [];
  }

  const matches = [];
  const processedCodes = new Set();

  // Log some sample elements to help debug
  if (elements.length > 0) {
    console.log("Sample elements for debugging:");
    console.log(JSON.stringify(elements.slice(0, 2), null, 2));
  }

  // Create a map of normalized codes for faster lookup
  const normalizedCostCodes = new Map();
  Object.entries(unitCosts).forEach(([code, costInfo]) => {
    const normalizedCode = normalizeEbkpCode(code);
    normalizedCostCodes.set(normalizedCode, { code, costInfo });
  });

  console.log(`Normalized ${normalizedCostCodes.size} cost codes for lookup`);

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
    console.log(
      `Processing element code: ${ebkpCode} (normalized: ${normalizedCode})`
    );

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

  console.log(
    `Found ${matches.length} matches from ${elements.length} elements`
  );

  // Cache the results
  cachedMatches = matches;
  lastMatchTimestamp = Date.now();

  return matches;
}
