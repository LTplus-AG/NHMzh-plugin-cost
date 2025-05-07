const { MongoClient, ObjectId } = require("mongodb");
const dotenv = require("dotenv");

// Ensure environment variables are loaded
dotenv.config();

// Configuration - Replace with environment variables in production
const MONGODB_HOST = process.env.MONGODB_HOST || "mongodb";
const MONGODB_PORT = process.env.MONGODB_PORT || "27017";
const MONGODB_COST_USER = process.env.MONGODB_COST_USER;
const MONGODB_COST_PASSWORD = process.env.MONGODB_COST_PASSWORD;
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || "cost"; // Cost DB
const MONGODB_QTO_DATABASE = process.env.MONGODB_QTO_DATABASE || "qto"; // QTO DB

if (!MONGODB_COST_USER || !MONGODB_COST_PASSWORD) {
  console.error(
    "ERROR: MONGODB_COST_USER or MONGODB_COST_PASSWORD environment variables are not set. Cost service DB operations will fail."
  );
  // Decide if you want to throw an error or try to continue without auth (not recommended)
  // throw new Error("Missing MongoDB credentials for cost service");
}

// Construct the connection URI using specific service credentials
const mongoUri = `mongodb://${MONGODB_COST_USER}:${MONGODB_COST_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DATABASE}?authSource=admin`;

let client = null;
let costDb = null;
let qtoDb = null;
let connectionRetries = 0;
const MAX_RETRIES = parseInt(process.env.MONGODB_CONNECT_MAX_RETRIES || "5");
const RETRY_DELAY_MS = 3000; // Wait 3 seconds between retries

/**
// Track elements we've already sent to Kafka to prevent duplicates
const processedKafkaElements = new Set();

// Clean up processedKafkaElements Set periodically to prevent memory leaks
const KAFKA_ELEMENT_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  const beforeSize = processedKafkaElements.size;
  if (beforeSize > 0) {
    console.log(
      `Cleaning up Kafka processed elements cache. Before: ${beforeSize} elements`
    );
    processedKafkaElements.clear();
    console.log(`Kafka processed elements cache cleared.`);
  }
}, KAFKA_ELEMENT_CLEANUP_INTERVAL);

/**
 * Connect to MongoDB and initialize database references
 */
async function connectToMongoDB() {
  if (client) {
    // Already connected
    return { client, costDb, qtoDb };
  }

  let retries = 0;

  while (retries < MAX_RETRIES) {
    console.log(
      `Attempting MongoDB connection (Attempt ${
        retries + 1
      }/${MAX_RETRIES}) to ${MONGODB_HOST} using user ${MONGODB_COST_USER}...`
    );
    let tempClient = null;
    try {
      tempClient = new MongoClient(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
      });

      await tempClient.connect();

      // Assign to global variables upon successful connection
      client = tempClient;
      costDb = client.db(MONGODB_DATABASE);
      qtoDb = client.db(MONGODB_QTO_DATABASE);

      console.log("Successfully connected to MongoDB");
      console.log(
        `Using databases: cost=${costDb.databaseName}, qto=${qtoDb.databaseName}`
      );

      await initializeCollections();
      return { client, costDb, qtoDb }; // Success: exit loop and return
    } catch (error) {
      console.error(
        `MongoDB connection attempt ${retries + 1} failed:`,
        error.message // Log only the error message for brevity
      );
      retries++;
      if (tempClient) {
        await tempClient.close(); // Ensure temporary client is closed on error
      }

      if (retries < MAX_RETRIES) {
        console.log(
          `Retrying connection in ${RETRY_DELAY_MS / 1000} seconds...`
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error("Max MongoDB connection retries reached.");
        // Reset global client state if all retries fail
        client = null;
        costDb = null;
        qtoDb = null;
        // Rethrow the last error after max retries
        throw new Error(
          `Failed to connect to MongoDB after ${MAX_RETRIES} attempts: ${error.message}`
        );
      }
    }
  }
  // Should not be reached if MAX_RETRIES > 0, but satisfies TS compiler
  throw new Error("MongoDB connection failed unexpectedly after retry loop.");
}

/**
 * Initialize collections and create indexes
 */
async function initializeCollections() {
  try {
    const costCollectionNames = await costDb.listCollections().toArray();
    const qtoCollectionNames = await qtoDb.listCollections().toArray();

    // Ensure required collections exist in QTO database
    if (!qtoCollectionNames.some((c) => c.name === "elements")) {
      await qtoDb.createCollection("elements");
      console.log("Created elements collection in QTO DB");
    }
    if (!qtoCollectionNames.some((c) => c.name === "projects")) {
      await qtoDb.createCollection("projects");
      console.log("Created projects collection in QTO DB");
    }

    // Create CostData collection if it doesn't exist
    if (!costCollectionNames.some((c) => c.name === "costData")) {
      await costDb.createCollection("costData");
      console.log("Created costData collection");
    }

    // Create CostSummaries collection if it doesn't exist
    if (!costCollectionNames.some((c) => c.name === "costSummaries")) {
      await costDb.createCollection("costSummaries");
      console.log("Created costSummaries collection");
    }
    // Create CostElements collection if it doesn't exist
    if (!costCollectionNames.some((c) => c.name === "costElements")) {
      await costDb.createCollection("costElements");
      console.log("Created costElements collection");
    }

    // REMOVED: Index creation is handled by init-mongo.js
    // await costDb.collection("costData").createIndex({ element_id: 1 });
    // await costDb.collection("costSummaries").createIndex({ project_id: 1 });

    console.log("MongoDB collections checked/ensured by cost-websocket");
  } catch (error) {
    console.error("Error ensuring collections exist (cost-websocket):", error);
    // Do not throw error here, allow service to continue if collections exist
    // throw error;
  }
}

/**
 * Close the MongoDB connection
 */
async function closeMongoDB() {
  if (client) {
    try {
      await client.close();
      console.log("MongoDB connection closed");
    } catch (error) {
      console.error("Error closing MongoDB connection:", error);
    } finally {
      client = null;
      costDb = null;
      qtoDb = null;
    }
  }
}

/**
 * Ensure the connection is established before any operation
 */
async function ensureConnection() {
  if (!client) {
    console.log("No active MongoDB client, attempting initial connection...");
    // connectToMongoDB now includes retry logic internally
    await connectToMongoDB();
  } else {
    try {
      // Test the connection
      await client.db("admin").command({ ping: 1 });
    } catch (error) {
      console.error(
        "MongoDB connection check failed, attempting to reconnect:",
        error.message
      );
      await closeMongoDB(); // Close the potentially broken client

      // Try to reconnect using the function with retry logic
      try {
        await connectToMongoDB();
      } catch (reconnectError) {
        // If reconnection (with retries) fails, throw a specific error
        console.error(
          "Failed to reconnect to MongoDB after retries:",
          reconnectError
        );
        throw new Error(
          `Database connection lost and could not reconnect: ${reconnectError.message}`
        );
      }
    }
  }

  // Return the database references if connection is successful
  return {
    client,
    costDb,
    qtoDb,
  };
}

/**
 * Save cost data for an element
 */
async function saveCostData(elementData, costResult) {
  await ensureConnection();

  try {
    // Generate new ObjectIds if not provided
    const elementId = elementData._id
      ? new ObjectId(elementData._id)
      : new ObjectId();
    const projectId = elementData.project_id
      ? new ObjectId(elementData.project_id)
      : new ObjectId();

    // First, save the element data to the qto database
    const elementDoc = {
      _id: elementId,
      project_id: projectId,
      ebkp_code: elementData.ebkp_code,
      area: elementData.area || 0,
      volume: elementData.volume || 0,
      length: elementData.length || 0,
      metadata: elementData.metadata || {},
      created_at: new Date(),
      updated_at: new Date(),
    };

    console.log(
      `Saving element data to qto.elements: ${JSON.stringify(elementDoc)}`
    );

    // Upsert the element document
    await qtoDb.collection("elements").updateOne(
      { _id: elementId },
      {
        $set: elementDoc,
        $setOnInsert: { created_at: new Date() },
        $currentDate: { updated_at: true },
      },
      { upsert: true }
    );

    // Generate a unique ID for this cost data item
    const costItemId = new ObjectId();

    // Now save the cost data to the cost database - this comes directly from input
    const costData = {
      _id: costItemId,
      project_id: projectId,
      ebkp_code: elementData.ebkp_code, // Store the EBKP code
      unit_cost: costResult.unitCost || 0,
      quantity: elementData.area || 0, // Use area as quantity
      total_cost: costResult.totalCost || 0,
      currency: costResult.currency || "CHF",
      calculation_date: new Date(),
      calculation_method: costResult.method || "excel-import",
      metadata: {
        ebkp_code: elementData.ebkp_code,
        source: "plugin-cost",
        ...elementData.metadata,
      },
      created_at: new Date(),
      updated_at: new Date(),
    };

    console.log(
      `Saving cost data to cost.costData: ${JSON.stringify(costData)}`
    );

    // Insert the cost data as a new document instead of updating
    const result = await costDb.collection("costData").insertOne(costData);

    // Save to costElements collection
    // First, get the full QTO element data to ensure we have all details
    const qtoElement = await qtoDb.collection("elements").findOne({
      _id: elementId,
    });

    if (qtoElement) {
      // Calculate total cost based on element's quantity/area
      const elementArea =
        qtoElement.original_area ||
        qtoElement.quantity ||
        qtoElement.properties?.area ||
        elementData.area ||
        0;
      const elementTotalCost = (costResult.unitCost || 0) * elementArea;

      // Create a document that preserves the QTO element structure exactly
      // but adds cost data
      const costElementDoc = {
        // Use the QTO element as the base
        ...qtoElement,

        // Generate a new ID for this collection
        _id: new ObjectId(),

        // Reference to original QTO element
        qto_element_id: qtoElement._id,

        // Store QTO element status for filtering
        qto_status: qtoElement.status || "active",

        // Reference to the cost data
        cost_item_id: costItemId,

        // Add cost data without changing the structure
        unit_cost: costResult.unitCost || 0,
        total_cost: elementTotalCost,
        currency: costResult.currency || "CHF",

        // Add cost data to properties
        properties: {
          ...qtoElement.properties,
          cost_data: {
            unit_cost: costResult.unitCost || 0,
            total_cost: elementTotalCost,
            source: costResult.method || "excel-import",
            timestamp: new Date(),
          },
        },

        // Update timestamps
        qto_created_at: qtoElement.created_at,
        qto_updated_at: qtoElement.updated_at,
        created_at: new Date(),
        updated_at: new Date(),
      };

      console.log(
        `Saving cost element to cost.costElements: ${JSON.stringify(
          costElementDoc
        )}`
      );

      // First delete any existing entries for this QTO element to avoid duplicates
      await costDb
        .collection("costElements")
        .deleteMany({ qto_element_id: elementId });

      // Then insert the new costElement document
      await costDb.collection("costElements").insertOne(costElementDoc);
    } else {
      console.log(
        `QTO element with ID ${elementId} not found, skipping costElements update`
      );
    }

    // Update the project cost summary
    await updateProjectCostSummary(projectId);

    return { elementId, projectId, result };
  } catch (error) {
    console.error("Error saving cost data:", error);
    throw error; // Throw the error to handle it in the calling function
  }
}

/**
 * Get element data from QTO database
 */
async function getQtoElement(elementId) {
  await ensureConnection();

  try {
    return await qtoDb.collection("elements").findOne({
      _id: new ObjectId(elementId),
    });
  } catch (error) {
    console.error("Error getting QTO element:", error);
    return null;
  }
}

/**
 * Get elements by project ID
 */
async function getElementsByProject(projectId) {
  await ensureConnection();

  try {
    const allElements = await qtoDb
      .collection("elements")
      .find({
        project_id: new ObjectId(projectId),
        status: "active", // Only include elements with active status
      })
      .toArray();

    // Check if any pending elements exist to log the information
    const pendingCount = await qtoDb.collection("elements").countDocuments({
      project_id: new ObjectId(projectId),
      status: "pending",
    });

    if (pendingCount > 0) {
      console.log(
        `Skipped ${pendingCount} QTO elements with pending status for project ${projectId}`
      );
    }

    console.log(
      `Found ${allElements.length} active QTO elements for project ${projectId}`
    );
    return allElements;
  } catch (error) {
    console.error("Error getting elements by project:", error);
    return [];
  }
}

/**
 * Get cost data for an element
 */
async function getCostDataForElement(elementId) {
  await ensureConnection();

  try {
    return await costDb.collection("costData").findOne({
      element_id: new ObjectId(elementId),
    });
  } catch (error) {
    console.error("Error getting cost data for element:", error);
    return null;
  }
}

/**
 * Update project cost summary
 */
async function updateProjectCostSummary(projectId) {
  await ensureConnection();

  try {
    // Handle ObjectId conversion safely
    let projectObjId;
    try {
      projectObjId =
        typeof projectId === "string" ? new ObjectId(projectId) : projectId;
    } catch (error) {
      console.error(`Invalid project ID format: ${projectId}`, error);
      return { error: `Invalid project ID format: ${projectId}` };
    }

    // Get the costElements - these should be the single source of truth
    // This avoids double-counting that might happen when combining costElements and costData
    const costElements = await costDb
      .collection("costElements")
      .find({
        project_id: projectObjId,
      })
      .toArray();

    // Get costData count for reference only
    const costDataCount = await costDb.collection("costData").countDocuments({
      project_id: projectObjId,
    });

    if (costElements.length === 0) {
      console.log(`No cost elements found for project ${projectId}`);
      return {
        project_id: projectObjId,
        elements_count: 0,
        cost_data_count: costDataCount,
        total_from_cost_data: 0,
        total_from_elements: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    // Create a map of element IDs to prevent double counting in hierarchical elements
    const processedElementIds = new Set();

    // Calculate total from costElements - only count each element once
    // This mimics what the UI does in CostTableRow.tsx
    let totalFromElements = 0;

    costElements.forEach((element) => {
      const elementId = element._id.toString();
      if (!processedElementIds.has(elementId)) {
        processedElementIds.add(elementId);
        // Only add the element's total cost if it has one
        if (element.total_cost) {
          totalFromElements += element.total_cost;
        }
      }
    });

    // For reference only, calculate total from costData
    const costDataTotal = await costDb
      .collection("costData")
      .aggregate([
        { $match: { project_id: projectObjId } },
        { $group: { _id: null, total: { $sum: "$total_cost" } } },
      ])
      .toArray()
      .then((result) => result[0]?.total || 0)
      .catch((_) => 0);

    // Create simplified summary document with only the requested fields
    const summary = {
      project_id: projectObjId,
      elements_count: costElements.length,
      cost_data_count: costDataCount,
      total_from_cost_data: costDataTotal,
      total_from_elements: totalFromElements,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Log the summary for debugging
    console.log(`Project cost summary for ${projectId}:`, {
      elements_count: summary.elements_count,
      cost_data_count: summary.cost_data_count,
      total_from_elements: summary.total_from_elements,
      total_from_cost_data: summary.total_from_cost_data,
    });

    const result = await costDb
      .collection("costSummaries")
      .updateOne(
        { project_id: projectObjId },
        { $set: summary },
        { upsert: true }
      );

    return summary;
  } catch (error) {
    console.error("Error updating project cost summary:", error);
    return { error: `Failed to update project summary: ${error.message}` };
  }
}

/**
 * Get all elements for a project
 */
async function getAllElementsForProject(projectName) {
  await ensureConnection();

  try {
    console.log(`Looking up project elements by name: ${projectName}`);
    let elements = [];

    // First, check if qtoDb has a projects collection where we can find the project ID
    try {
      const projectsCollection = await qtoDb
        .listCollections({ name: "projects" })
        .toArray();

      if (projectsCollection.length > 0) {
        // Projects collection exists in QTO database
        const project = await qtoDb.collection("projects").findOne({
          name: { $regex: new RegExp(`^${projectName}$`, "i") },
        });

        if (project) {
          console.log(
            `Found project in QTO database: ${project.name}, ID: ${project._id}`
          );

          // Look up elements using the project ID
          elements = await qtoDb
            .collection("elements")
            .find({
              project_id: project._id,
              status: "active", // Only include elements with active status
            })
            .toArray();

          // Check if any pending elements exist to log the information
          const pendingCount = await qtoDb
            .collection("elements")
            .countDocuments({
              project_id: project._id,
              status: "pending",
            });

          if (pendingCount > 0) {
            console.log(
              `Skipped ${pendingCount} QTO elements with pending status for project ${projectName}`
            );
          }

          console.log(
            `Found ${elements.length} active QTO elements using project ID ${project._id}`
          );
        }
      } else {
        console.log(
          "No projects collection in QTO database, trying shared database"
        );
      }
    } catch (error) {
      console.warn(
        `Error checking for projects collection in QTO database: ${error.message}`
      );
    }

    // If we didn't find elements through the project ID, try different search methods
    if (elements.length === 0) {
      // Try looking for elements with different combinations of project name fields and eBKP code locations
      const searches = [
        // By project_name field
        { project_name: { $regex: new RegExp(projectName, "i") } },

        // By properties.project_name field
        { "properties.project_name": { $regex: new RegExp(projectName, "i") } },

        // By eBKP classification - look for elements that might match this project
        { "properties.classification.system": "EBKP" },

        // By ebkph property
        { "properties.ebkph": { $exists: true } },
      ];

      for (const searchQuery of searches) {
        if (elements.length === 0) {
          try {
            const foundElements = await qtoDb
              .collection("elements")
              .find({
                ...searchQuery,
                status: "active", // Only include elements with active status
              })
              .limit(200) // Limit to avoid too many results
              .toArray();

            console.log(
              `Found ${
                foundElements.length
              } active elements using search: ${JSON.stringify(searchQuery)}`
            );

            if (foundElements.length > 0) {
              elements = foundElements;
              break;
            }
          } catch (err) {
            console.error(
              `Error with search query ${JSON.stringify(searchQuery)}:`,
              err
            );
          }
        }
      }
    }

    // If still no elements, check all collections in QTO database for elements related to this project
    if (elements.length === 0) {
      console.log(
        "No elements found, dumping available collections and sample documents to debug"
      );

      // Get list of all collections in QTO database
      const collections = await qtoDb.listCollections().toArray();
      console.log(
        `Available collections in QTO database: ${collections
          .map((c) => c.name)
          .join(", ")}`
      );

      // Sample a document from each collection to understand their structure
      for (const collection of collections) {
        const sampleDoc = await qtoDb.collection(collection.name).findOne({});
        if (sampleDoc) {
          console.log(
            `Sample document from ${collection.name}:`,
            JSON.stringify(sampleDoc, (key, value) =>
              key === "_id" ? value.toString() : value
            ).substring(0, 200) + "..."
          );
        }
      }

      return [];
    }

    // Get cost data for these elements
    const elementIds = elements.map((e) => e._id);
    const costData = await costDb
      .collection("costData")
      .find({
        element_id: { $in: elementIds },
      })
      .toArray();

    console.log(
      `Found ${costData.length} cost data entries for project elements`
    );

    // Create a map of cost data by element ID for quick lookup
    const costDataMap = {};
    costData.forEach((cost) => {
      costDataMap[cost.element_id.toString()] = cost;
    });

    // Enhance elements with cost data
    const enhancedElements = elements.map((element) => {
      const elementId = element._id.toString();
      const cost = costDataMap[elementId];

      // If the element already has cost data embedded, use it
      if (element.unit_cost !== undefined && element.total_cost !== undefined) {
        return {
          ...element,
          cost_data: {
            unit_cost: element.unit_cost,
            total_cost: element.total_cost,
            currency: element.currency || "CHF",
            calculation_date: element.updated_at,
          },
        };
      }

      // Otherwise look for cost data in the cost database
      return {
        ...element,
        cost_data: cost
          ? {
              unit_cost: cost.unit_cost,
              total_cost: cost.total_cost,
              currency: cost.currency,
              calculation_date: cost.calculation_date,
            }
          : null,
      };
    });

    return enhancedElements;
  } catch (error) {
    console.error("Error getting all elements for project:", error);
    return [];
  }
}

/**
 * Get cost elements by project ID
 * This returns elements from the costElements collection which combines QTO and cost data
 */
async function getCostElementsByProject(projectName) {
  await ensureConnection();

  try {
    console.log(`Looking up cost elements by project name: ${projectName}`);

    // First find the project ID
    const project = await qtoDb.collection("projects").findOne({
      name: { $regex: new RegExp(`^${projectName}$`, "i") },
    });

    if (!project) {
      console.warn(`Project not found with name: ${projectName}`);
      return {
        elements: [],
        summary: {
          count: 0,
          uniqueEbkpCodes: 0,
          ebkpCodes: [],
          totalArea: 0,
          totalCost: 0,
          currency: "CHF",
        },
      };
    }

    const projectId = project._id;
    console.log(`Found project with ID: ${projectId}`);

    // Get cost elements for this project
    const costElements = await costDb
      .collection("costElements")
      .find({
        project_id: projectId,
        qto_status: "active", // Only include cost elements for active QTO elements
      })
      .toArray();

    console.log(
      `Found ${costElements.length} cost elements for active QTO elements in project ${projectName}`
    );

    // Check if we have any cost elements for pending QTO elements
    const pendingElementsCount = await costDb
      .collection("costElements")
      .countDocuments({
        project_id: projectId,
        qto_status: "pending",
      });

    if (pendingElementsCount > 0) {
      console.log(
        `NOTE: Skipped ${pendingElementsCount} cost elements for pending QTO elements in project ${projectName}`
      );
    }

    // Compute summary statistics
    // Look for EBKP code in properties.classification.id or properties.ebkph
    const ebkpCodes = new Set();
    costElements.forEach((element) => {
      let code = null;
      if (element.properties?.classification?.id) {
        code = element.properties.classification.id;
      } else if (element.properties?.ebkph) {
        code = element.properties.ebkph;
      }
      if (code) {
        ebkpCodes.add(code);
      }
    });

    // Calculate total area using quantity or original_area
    const totalArea = costElements.reduce(
      (sum, element) => sum + (element.original_area || element.quantity || 0),
      0
    );

    const totalCost = costElements.reduce(
      (sum, element) => sum + (element.total_cost || 0),
      0
    );

    // Return elements with summary
    return {
      elements: costElements,
      summary: {
        count: costElements.length,
        uniqueEbkpCodes: ebkpCodes.size,
        ebkpCodes: Array.from(ebkpCodes),
        totalArea: totalArea,
        totalCost: totalCost,
        currency: costElements.length > 0 ? costElements[0].currency : "CHF",
      },
    };
  } catch (error) {
    console.error("Error getting cost elements by project:", error);
    return {
      elements: [],
      summary: {
        count: 0,
        uniqueEbkpCodes: 0,
        ebkpCodes: [],
        totalArea: 0,
        totalCost: 0,
        currency: "CHF",
      },
    };
  }
}

/**
 * Get cost elements by EBKP code
 * This returns elements from the costElements collection filtered by EBKP code
 */
async function getCostElementsByEbkpCode(ebkpCode) {
  await ensureConnection();

  try {
    console.log(`Looking up cost elements by EBKP code: ${ebkpCode}`);

    // Find elements where either properties.classification.id or properties.ebkph match
    const costElements = await costDb
      .collection("costElements")
      .find({
        $or: [
          { "properties.classification.id": ebkpCode },
          { "properties.ebkph": ebkpCode },
        ],
      })
      .toArray();

    console.log(
      `Found ${costElements.length} cost elements for EBKP code ${ebkpCode}`
    );

    // Compute summary statistics
    const projectIds = new Set(
      costElements.map((element) => element.project_id.toString())
    );
    const projects = [];

    for (const projectId of projectIds) {
      try {
        const project = await qtoDb.collection("projects").findOne({
          _id: new ObjectId(projectId),
        });
        if (project) {
          projects.push({
            id: projectId,
            name: project.name || "Unknown Project",
          });
        }
      } catch (error) {
        console.warn(`Could not find project with ID ${projectId}`);
      }
    }

    // Calculate total area using quantity or original_area
    const totalArea = costElements.reduce(
      (sum, element) => sum + (element.original_area || element.quantity || 0),
      0
    );

    const totalCost = costElements.reduce(
      (sum, element) => sum + (element.total_cost || 0),
      0
    );

    const avgUnitCost =
      costElements.length > 0
        ? costElements.reduce(
            (sum, element) => sum + (element.unit_cost || 0),
            0
          ) / costElements.length
        : 0;

    // Return elements with summary
    return {
      elements: costElements,
      summary: {
        count: costElements.length,
        projects: projects,
        ebkpCode: ebkpCode,
        totalArea: totalArea,
        totalCost: totalCost,
        avgUnitCost: avgUnitCost,
        currency: costElements.length > 0 ? costElements[0].currency : "CHF",
      },
    };
  } catch (error) {
    console.error("Error getting cost elements by EBKP code:", error);
    return {
      elements: [],
      summary: {
        count: 0,
        projects: [],
        ebkpCode: ebkpCode,
        totalArea: 0,
        totalCost: 0,
        avgUnitCost: 0,
        currency: "CHF",
      },
    };
  }
}

// Helper function to normalize eBKP codes for better matching
// DUPLICATED from server.js to avoid circular dependency
function normalizeEbkpCode(code) {
  if (!code) return code;

  // Convert to uppercase for consistent matching
  const upperCode = code.toUpperCase().trim();

  // Remove any spaces
  let normalized = upperCode.replace(/\s+/g, "");

  // Handle patterns like C01.01 -> C1.1, C01 -> C1 etc.
  // First try the format with dots
  normalized = normalized.replace(/([A-Z])0*(\d+)\.0*(\d+)/g, "$1$2.$3");
  // Then handle codes without dots
  normalized = normalized.replace(/([A-Z])0*(\d+)$/g, "$1$2");
  // Handle special case "C.1" format (missing number after letter)
  normalized = normalized.replace(/([A-Z])\.(\d+)/g, "$1$2");

  // Basic check if it resembles an EBKP code, otherwise return original normalized
  if (!/^[A-Z][0-9]/.test(normalized)) {
    // console.log(`DEBUG: Code "${code}" normalized to "${normalized}" might not be standard EBKP.`);
    return normalized; // Return space-removed, uppercase version if not standard format
  }

  return normalized;
}

/**
 * Save a batch of cost data (Refactored Logic)
 * Creates costElements entries based on active QTO elements and existing costData.
 * @param {Array} costItems - Original cost items from Excel (used for reference/logging)
 * @param {string} projectName - Name of the project
 * @param {Function} sendKafkaMessage - Optional callback to send Kafka messages
 * @returns {Promise<Object>} Result with counts
 */
async function saveCostDataBatch(
  costItems, // These are the EnhancedCostItem[] from PreviewModal, already BIM-mapped
  projectName,
  sendKafkaMessage = null
) {
  try {
    const { costDb: costDatabase, qtoDb: qtoDatabase } =
      await ensureConnection();

    console.log(
      `Starting cost element update for project: ${projectName} using pre-matched cost items.`
    );

    // 1. Find the full project document (same as before)
    console.log(`Looking up project in QTO database: ${projectName}`);
    const qtoProject = await qtoDatabase.collection("projects").findOne(
      { name: { $regex: new RegExp(`^${projectName}$`, "i") } },
      {
        projection: {
          _id: 1,
          name: 1,
          metadata: 1,
          created_at: 1,
          updated_at: 1,
        },
      }
    );

    if (!qtoProject) {
      console.warn(
        `Project ${projectName} not found. Cannot update cost elements.`
      );
      return { insertedCount: 0, message: "Project not found" };
    }
    const projectId = qtoProject._id;
    console.log(`Found project ID: ${projectId}, Name: ${qtoProject.name}`);
    console.log(
      "Fetched qtoProject data for cost batch:",
      JSON.stringify(qtoProject, null, 2)
    );

    // Extract required metadata for Kafka (same as before)
    const originalTimestamp = qtoProject.metadata?.upload_timestamp;
    let kafkaMetadata = null;
    if (!originalTimestamp) {
      console.error(
        `CRITICAL: Original upload_timestamp missing in metadata for project ${projectName} (ID: ${projectId}). Kafka messages for cost elements might be inaccurate.`
      );
      // Create a fallback kafkaMetadata to allow processing, but log critical warning
      kafkaMetadata = {
        project: qtoProject.name,
        filename: qtoProject.metadata?.filename || `${projectName}_model.ifc`,
        timestamp:
          qtoProject.updated_at?.toISOString() || new Date().toISOString(), // Fallback timestamp
        fileId: qtoProject.metadata?.file_id || projectId.toString(),
      };
      console.warn(
        "Using fallback Kafka metadata due to missing upload_timestamp:",
        JSON.stringify(kafkaMetadata)
      );
    } else {
      kafkaMetadata = {
        project: qtoProject.name,
        filename: qtoProject.metadata?.filename || "unknown.ifc",
        timestamp: new Date(originalTimestamp).toISOString(),
        fileId: qtoProject.metadata?.file_id || projectId.toString(),
      };
      console.log(
        `Prepared Kafka metadata using upload_timestamp: ${JSON.stringify(
          kafkaMetadata
        )}`
      );
    }

    // 2. Delete existing cost elements (same as before)
    console.log(`Deleting existing cost elements for project ${projectId}`);
    const deleteResult = await costDatabase
      .collection("costElements")
      .deleteMany({ project_id: projectId });
    console.log(`Deleted ${deleteResult.deletedCount} existing cost elements`);

    // 3. Create a lookup map from the provided costItems (BIM-mapped data)
    // The key is the normalized eBKP code.
    const mappedCostItemsLookup = new Map();
    costItems.forEach((item) => {
      if (item.ebkp) {
        const normalizedCode = normalizeEbkpCode(item.ebkp);
        // Store the item itself, it contains unit_cost, area (BIM-mapped), and cost (BIM-mapped total)
        mappedCostItemsLookup.set(normalizedCode, item);
      }
    });
    console.log(
      `Created lookup map for ${mappedCostItemsLookup.size} provided (BIM-mapped) cost items.`
    );

    // 4. Fetch active QTO elements (same as before)
    console.log(`Fetching active QTO elements for project ${projectId}`);
    const activeQtoElements = await qtoDatabase
      .collection("elements")
      .find({ project_id: projectId, status: "active" })
      .toArray();
    console.log(`Found ${activeQtoElements.length} active QTO elements.`);

    // 5. Iterate through active QTO elements, apply costs from mappedCostItemsLookup, and build costElementsToSave and elementsForKafka
    const costElementsToSave = [];
    const elementsForKafka = [];
    let processedCount = 0;
    let skippedCount = 0;

    for (const qtoElement of activeQtoElements) {
      const qtoElementEbkpCode = getElementEbkpCode(qtoElement);
      if (!qtoElementEbkpCode) {
        skippedCount++;
        continue;
      }
      const normalizedQtoEbkp = normalizeEbkpCode(qtoElementEbkpCode);
      const matchedBimMappedItem = mappedCostItemsLookup.get(normalizedQtoEbkp);

      if (matchedBimMappedItem && matchedBimMappedItem.cost_unit > 0) {
        const unitCost = matchedBimMappedItem.cost_unit;

        // Determine the actual quantity of the QTO element
        let elementQuantity = 0;
        if (
          qtoElement.quantity &&
          typeof qtoElement.quantity === "object" &&
          qtoElement.quantity.value !== undefined
        ) {
          elementQuantity = qtoElement.quantity.value;
        } else if (
          qtoElement.quantity !== undefined &&
          typeof qtoElement.quantity === "number"
        ) {
          elementQuantity = qtoElement.quantity;
        } else if (qtoElement.area !== undefined) {
          // Fallback to area if specific quantity field is not present/structured
          elementQuantity = qtoElement.area;
        } else if (qtoElement.volume !== undefined) {
          elementQuantity = qtoElement.volume;
        } else if (qtoElement.length !== undefined) {
          elementQuantity = qtoElement.length;
        }
        // Add more checks if other quantity fields are possible e.g. qtoElement.properties.NetVolume etc.

        const elementTotalCost = unitCost * elementQuantity;

        // Log the calculation details
        console.log(
          `[Cost Calc Debug - saveCostDataBatch] QTO Element ID: ${qtoElement._id}, EBKP: ${qtoElementEbkpCode} (Normalized: ${normalizedQtoEbkp}), Matched UnitCost: ${unitCost}, QTO ElementQuantity: ${elementQuantity}, Calculated TotalCost: ${elementTotalCost}`
        );

        // Find the original Excel costData entry for cost_item_id reference, if needed.
        // This step might be optional if cost_item_id is not strictly required or can be derived.
        // For now, we'll try to find it, but it's less critical than using the correct unit_cost.
        const correspondingRawCostData = await costDatabase
          .collection("costData")
          .findOne(
            {
              project_id: projectId,
              ebkp_code: { $regex: new RegExp(`^${qtoElementEbkpCode}$`, "i") },
            }, // Match case-insensitively
            { projection: { _id: 1 } }
          );

        const costElementDoc = {
          ...qtoElement,
          _id: new ObjectId(),
          qto_element_id: qtoElement._id,
          qto_status: "active",
          cost_item_id: correspondingRawCostData?._id || new ObjectId(), // Link to raw costData or new ID if not found
          unit_cost: unitCost,
          total_cost: elementTotalCost,
          currency: "CHF",
          properties: {
            ...qtoElement.properties,
            cost_data: {
              unit_cost: unitCost,
              total_cost: elementTotalCost,
              source: matchedBimMappedItem.areaSource || "excel-bim-mapped",
              timestamp: new Date(),
            },
          },
          qto_created_at: qtoElement.created_at,
          qto_updated_at: qtoElement.updated_at,
          created_at: new Date(),
          updated_at: new Date(),
        };
        costElementsToSave.push(costElementDoc);

        // Prepare Kafka data using the BIM-mapped costs and QTO element details
        elementsForKafka.push({
          // ...qtoElement, // Spread original QTO element
          project: kafkaMetadata.project, // Use consistent project name from metadata
          filename: kafkaMetadata.filename, // Use consistent filename from metadata
          timestamp: kafkaMetadata.timestamp, // Use consistent timestamp from metadata for the batch event
          fileId: kafkaMetadata.fileId, // Use consistent fileId from metadata

          id: qtoElement.global_id || qtoElement._id.toString(), // Kafka message 'id' for the element
          element_id: qtoElement._id.toString(), // Original element's DB ID

          cost_unit: unitCost,
          cost: elementTotalCost, // This is QTO_element_quantity * unitCost

          // Include other relevant QTO element fields for the Kafka message
          category:
            qtoElement.ifc_class || qtoElement.properties?.category || "",
          level: qtoElement.level || qtoElement.properties?.level || "",
          ebkph: qtoElementEbkpCode, // The element's own EBKP code
          is_structural:
            qtoElement.properties?.structuralRole === "load_bearing" ||
            qtoElement.is_structural ||
            false,
          fire_rating: qtoElement.properties?.fireRating || "",
          // Add quantity and unit if available and structured in qtoElement.quantity
          quantity_value: qtoElement.quantity?.value,
          quantity_unit: qtoElement.quantity?.unit,
          quantity_type: qtoElement.quantity?.type,
          // Legacy area if qtoElement.quantity is not structured
          area: !qtoElement.quantity?.value ? qtoElement.area : undefined,
        });
        processedCount++;
      } else {
        if (!matchedBimMappedItem) {
          // console.log(`Skipping QTO element ${qtoElement._id} (EBKP: ${qtoElementEbkpCode}) as no BIM-mapped cost item was found for it.`);
        } else {
          // console.log(`Skipping QTO element ${qtoElement._id} (EBKP: ${qtoElementEbkpCode}) as its BIM-mapped cost item has unit_cost <= 0.`);
        }
        skippedCount++;
      }
    }
    console.log(
      `Prepared ${processedCount} cost elements to save based on BIM-mapped items. Skipped ${skippedCount} active QTO elements (no match or zero unit cost).`
    );

    // 6. Insert new cost elements (same as before)
    let insertResult = { insertedCount: 0 };
    if (costElementsToSave.length > 0) {
      console.log(`Inserting ${costElementsToSave.length} cost elements...`);
      insertResult = await costDatabase
        .collection("costElements")
        .insertMany(costElementsToSave, { ordered: false });
      console.log(
        `Successfully inserted ${insertResult.insertedCount} cost elements.`
      );
    }

    // 7. Update project summary (same as before)
    await updateProjectCostSummary(projectId);

    // 8. Send elements to Kafka, passing the prepared metadata object
    let kafkaResult = { success: false, count: 0 };
    // Only proceed if kafkaMetadata was successfully created
    if (
      sendKafkaMessage &&
      typeof sendKafkaMessage === "function" &&
      elementsForKafka.length > 0 &&
      kafkaMetadata // <-- Check if metadata is valid
    ) {
      console.log(
        `Sending ${elementsForKafka.length} processed elements to Kafka...`
      );
      try {
        // Pass elements and the verified kafkaMetadata object
        kafkaResult = await sendKafkaMessage(elementsForKafka, kafkaMetadata);
        console.log(`Kafka send result: ${JSON.stringify(kafkaResult)}`);
      } catch (kafkaError) {
        console.error(
          "Error sending elements to Kafka via callback:",
          kafkaError
        );
      }
    }

    // ... (return statement remains the same) ...
    return {
      // Return counts based on the new logic
      deletedCostElements: deleteResult.deletedCount,
      processedQtoElements: processedCount,
      skippedQtoElements: skippedCount,
      insertedCostElements: insertResult.insertedCount,
      projectId: projectId,
      kafkaSent: kafkaResult?.count || 0,
    };
  } catch (error) {
    console.error("Error processing cost elements batch:", error);
    throw error;
  }
}

// Create a more lenient way of extracting EBKP from an element
function getElementEbkpCode(element) {
  let ebkpCode = null;

  // Log the element structure to debug what's available
  console.log(
    `DEBUG: Element structure for ID ${element._id}:`,
    JSON.stringify(
      {
        direct_props: {
          ebkp_code: element.ebkp_code,
          ebkph: element.ebkph,
          classification: element.classification,
        },
        nested_props: {
          classification: element.properties?.classification,
          ebkph: element.properties?.ebkph,
        },
      },
      null,
      2
    )
  );

  // Check all possible locations for EBKP code (in order of preference)
  // 1. Check properties.classification.id
  if (element.properties?.classification?.id) {
    ebkpCode = element.properties.classification.id;
  }
  // 2. Check properties.ebkph
  else if (element.properties?.ebkph) {
    ebkpCode = element.properties.ebkph;
  }
  // 3. Check direct classification.id
  else if (element.classification?.id) {
    ebkpCode = element.classification.id;
  }
  // 4. Check direct ebkph
  else if (element.ebkph) {
    ebkpCode = element.ebkph;
  }
  // 5. Check direct ebkp_code
  else if (element.ebkp_code) {
    ebkpCode = element.ebkp_code;
  }
  // 6. Check id if it looks like an EBKP code
  else if (element.id && /^[A-Za-z]\d+(\.\d+)*$/.test(element.id)) {
    ebkpCode = element.id;
  }

  // If we found a code, log it
  if (ebkpCode) {
    console.log(`Found EBKP code ${ebkpCode} for element ${element._id}`);
  } else {
    console.log(`No EBKP code found for element ${element._id}`);
  }

  return ebkpCode;
}

/**
 * Get all projects from QTO database
 */
async function getAllProjects() {
  await ensureConnection();

  try {
    const projects = await qtoDb
      .collection("projects")
      .find({}, { projection: { _id: 1, name: 1 } })
      .toArray();

    // Map to the expected format { id: string, name: string }
    const formattedProjects = projects.map((p) => ({
      id: p._id.toString(),
      name: p.name || "Unnamed Project", // Provide a default name
    }));

    console.log(`Found ${formattedProjects.length} projects in QTO database`);
    return formattedProjects;
  } catch (error) {
    console.error("Error getting all projects:", error);
    return [];
  }
}

module.exports = {
  connectToMongoDB,
  closeMongoDB,
  saveCostData,
  getQtoElement,
  getElementsByProject,
  getCostDataForElement,
  updateProjectCostSummary,
  getAllElementsForProject,
  saveCostDataBatch,
  getCostElementsByProject,
  getCostElementsByEbkpCode,
  getElementEbkpCode,
  getAllProjects,
  ObjectId,
};
