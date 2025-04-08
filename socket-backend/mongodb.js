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

/**
 * Connect to MongoDB and initialize database references
 */
async function connectToMongoDB() {
  if (client) {
    return { client, costDb, qtoDb };
  }

  console.log(
    `Attempting MongoDB connection to ${MONGODB_HOST} using user ${MONGODB_COST_USER}...`
  );

  try {
    client = new MongoClient(mongoUri, {
      useNewUrlParser: true, // Deprecated but included for compatibility awareness
      useUnifiedTopology: true, // Deprecated but included for compatibility awareness
      serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
      connectTimeoutMS: 10000, // Connection timeout
    });

    await client.connect();
    costDb = client.db(MONGODB_DATABASE);
    qtoDb = client.db(MONGODB_QTO_DATABASE); // Also get a handle to the QTO DB

    console.log("Successfully connected to MongoDB");
    console.log(
      `Using databases: cost=${costDb.databaseName}, qto=${qtoDb.databaseName}`
    );

    // Ensure collections exist (optional, but good practice)
    await initializeCollections();

    return { client, costDb, qtoDb };
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    // Clean up client if connection failed
    if (client) {
      await client.close();
      client = null;
      costDb = null;
      qtoDb = null;
    }
    // Rethrow or handle as appropriate for the application startup
    throw new Error(`Failed to connect to MongoDB: ${error.message}`);
  }
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
    await connectToMongoDB();
  } else {
    try {
      // Test the connection by running a simple command
      await client.db("admin").command({ ping: 1 });
    } catch (error) {
      console.error("MongoDB connection error, reconnecting:", error);
      await closeMongoDB();

      // Try to reconnect with the same retry logic as in connectToMongoDB
      try {
        await connectToMongoDB();
      } catch (reconnectError) {
        console.error("Failed to reconnect to MongoDB:", reconnectError);
        throw new Error(
          `Database connection failed: ${reconnectError.message}`
        );
      }
    }
  }

  // Return the database references so they can be used directly
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
    return await qtoDb
      .collection("elements")
      .find({
        project_id: new ObjectId(projectId),
      })
      .toArray();
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
            })
            .toArray();

          console.log(
            `Found ${elements.length} elements using project ID ${project._id}`
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
              .find(searchQuery)
              .limit(200) // Limit to avoid too many results
              .toArray();

            console.log(
              `Found ${
                foundElements.length
              } elements using search: ${JSON.stringify(searchQuery)}`
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
      .find({ project_id: projectId })
      .toArray();

    console.log(
      `Found ${costElements.length} cost elements for project ${projectName}`
    );

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

/**
 * Save a batch of cost data
 * @param {Array} costItems - Array of cost data items
 * @param {string} projectName - Name of the project
 * @param {Function} sendKafkaMessage - Optional callback to send Kafka messages
 * @returns {Promise<Object>} Result with counts
 */
async function saveCostDataBatch(
  costItems,
  projectName,
  sendKafkaMessage = null
) {
  try {
    // Ensure MongoDB connection and get database references
    const { costDb: costDatabase, qtoDb: qtoDatabase } =
      await ensureConnection();

    console.log(
      `Starting batch save for project: ${projectName}, ${costItems.length} items from matching QTO elements for costElements collection`
    );

    if (!costItems || costItems.length === 0) {
      console.warn("No cost items provided to save");
      return { insertedCount: 0, message: "No items to save" };
    }

    // First, find the project in QTO database
    console.log(`Looking up project in QTO database: ${projectName}`);
    const qtoProject = await qtoDatabase.collection("projects").findOne({
      name: { $regex: new RegExp(`^${projectName}$`, "i") },
    });

    let projectId;

    if (qtoProject) {
      // Use the existing QTO project ID
      projectId = qtoProject._id;
      console.log(`Found existing QTO project with ID: ${projectId}`);
    } else {
      // Create a new project ID if QTO project doesn't exist
      projectId = new ObjectId();
      console.log(`Creating new project with ID: ${projectId}`);

      // Create the project in QTO database
      await qtoDatabase.collection("projects").insertOne({
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

    // IMPORTANT NOTE: We do NOT delete costData entries here
    // This function is called during preview confirmation
    // costData entries are already saved during the Excel upload phase
    // and should not be touched here
    console.log(
      `NOTE: Not deleting costData entries in this flow - only updating costElements`
    );

    // Find existing QTO elements for this project
    console.log(`Fetching existing QTO elements for project ${projectName}`);
    let existingElements = await qtoDatabase
      .collection("elements")
      .find({ project_id: projectId })
      .toArray();

    console.log(
      `Found ${existingElements.length} existing QTO elements by project_id`
    );

    // If we didn't find many elements, try broader searches
    if (existingElements.length < 10) {
      console.log(
        "Few elements found by project ID, trying alternative searches..."
      );

      // Search for elements with eBKP classification
      const ebkpElements = await qtoDatabase
        .collection("elements")
        .find({
          $or: [
            { "properties.classification.system": "EBKP" },
            { "properties.ebkph": { $exists: true } },
            { ebkp_code: { $exists: true } },
          ],
        })
        .limit(300)
        .toArray();

      console.log(
        `Found ${ebkpElements.length} elements with eBKP codes via alternative search`
      );

      // Combine unique elements from both searches
      const allElementsMap = {};
      [...existingElements, ...ebkpElements].forEach((element) => {
        if (!allElementsMap[element._id]) {
          allElementsMap[element._id] = element;
        }
      });

      existingElements = Object.values(allElementsMap);
      console.log(
        `Total unique elements after combined searches: ${existingElements.length}`
      );
    }

    // Create a mapping from eBKP code to element ID
    const ebkpToElementMap = {};

    // Helper function to normalize eBKP codes for better matching
    const normalizeEbkpCode = (code) => {
      if (!code) return null;
      // Remove spaces, lowercase, remove any non-alphanumeric except dots
      return code.trim().replace(/\s+/g, "").toLowerCase();
    };

    // Create both normalized and original versions in the map
    existingElements.forEach((element) => {
      // Check all possible locations for eBKP code
      let ebkpCode = null;

      // 1. Check properties.ebkph
      if (element.properties?.ebkph) {
        ebkpCode = element.properties.ebkph;
      }
      // 2. Check properties.classification.id
      else if (element.properties?.classification?.id) {
        ebkpCode = element.properties.classification.id;
      }
      // 3. Check ebkp_code directly on element
      else if (element.ebkp_code) {
        ebkpCode = element.ebkp_code;
      }

      if (ebkpCode) {
        // Store with original code
        ebkpToElementMap[ebkpCode] = element._id;
        // Also store with normalized code
        const normalizedCode = normalizeEbkpCode(ebkpCode);
        if (normalizedCode && normalizedCode !== ebkpCode) {
          ebkpToElementMap[normalizedCode] = element._id;
        }
        console.log(`Mapped element ${element._id} to eBKP code ${ebkpCode}`);
      }
    });

    console.log(
      `Created mapping for ${
        Object.keys(ebkpToElementMap).length
      } elements by eBKP code`
    );

    // Create a map to store QTO elements by EBKP code for efficient lookup
    const ebkpToElementsMap = {};

    // Build the map of QTO elements by EBKP code
    existingElements.forEach((element) => {
      // Get EBKP code from any possible location
      let ebkpCode =
        element.properties?.ebkph ||
        element.properties?.classification?.id ||
        element.ebkp_code;

      if (ebkpCode) {
        if (!ebkpToElementsMap[ebkpCode]) {
          ebkpToElementsMap[ebkpCode] = [];
        }
        ebkpToElementsMap[ebkpCode].push(element);

        // Also add with normalized code
        const normalizedCode = normalizeEbkpCode(ebkpCode);
        if (normalizedCode && normalizedCode !== ebkpCode) {
          if (!ebkpToElementsMap[normalizedCode]) {
            ebkpToElementsMap[normalizedCode] = [];
          }
          ebkpToElementsMap[normalizedCode].push(element);
        }
      }
    });

    // Track which elements were matched
    const matchedElements = new Set();
    const unmatchedEbkpCodes = [];

    // Use a Map to track which QTO elements have already been processed for costElements
    const processedQtoElements = new Map();

    // Arrays to hold documents to save
    const elementOps = [];

    // STEP 1: Skip saving Excel items to costData - we've already done this separately
    console.log(`Skipping costData insertion - already saved during upload`);

    // STEP 2: Now process the QTO elements that match the Excel items
    // ----------------------------------------------------------------------
    costItems.forEach((item) => {
      // Get EBKP code and cost data
      const ebkpCode = item.ebkp || item.ebkph || item.id;
      const kennwert = item.cost_unit || item.kennwert || 0;

      // Skip items with zero unit cost
      if (kennwert <= 0) {
        console.log(
          `Skipping cost item with EBKP ${ebkpCode || ""} due to zero unit cost`
        );
        return;
      }

      if (!ebkpCode) {
        console.warn("Item has no EBKP code, skipping:", item);
        return;
      }

      // Normalize eBKP code for matching
      const normalizedCode = normalizeEbkpCode(ebkpCode);

      // Find matching QTO element
      let elementId = null;
      if (normalizedCode && ebkpToElementMap[normalizedCode]) {
        elementId = ebkpToElementMap[normalizedCode];
      } else if (ebkpToElementMap[ebkpCode]) {
        elementId = ebkpToElementMap[ebkpCode];
      }

      if (elementId) {
        matchedElements.add(ebkpCode);

        // Update existing QTO element with cost data
        elementOps.push({
          updateOne: {
            filter: {
              _id: elementId,
            },
            update: {
              $set: {
                unit_cost: kennwert,
                total_cost: item.totalChf || item.cost || 0,
                currency: "CHF",
                updated_at: new Date(),
                // Update metadata as an object with $set to avoid conflict
                metadata: {
                  // Preserve existing metadata if any
                  ...(existingElements.find(
                    (e) => e._id.toString() === elementId.toString()
                  )?.metadata || {}),
                  // Add cost-specific metadata
                  has_cost_data: true,
                  cost_updated_at: new Date(),
                },
              },
            },
          },
        });

        // Find QTO elements with this EBKP code
        const qtoElements =
          ebkpToElementsMap[normalizedCode] ||
          ebkpToElementsMap[ebkpCode] ||
          [];

        if (qtoElements.length > 0) {
          // Process each QTO element but store only one entry per element
          qtoElements.forEach((qtoElement) => {
            const qtoElementId = qtoElement._id.toString();

            // Check if we've already processed this QTO element
            if (!processedQtoElements.has(qtoElementId)) {
              // Calculate element-specific total cost based on its quantity/area
              const elementArea =
                qtoElement.original_area ||
                qtoElement.quantity ||
                qtoElement.properties?.area ||
                0;
              const elementTotalCost = kennwert * elementArea;

              // Store this cost data for this QTO element
              processedQtoElements.set(qtoElementId, {
                unit_cost: kennwert,
                total_cost: elementTotalCost,
                currency: "CHF",
                source: "excel-import",
                timestamp: new Date(),
              });

              // Send Kafka message for this element if callback provided
              if (sendKafkaMessage && typeof sendKafkaMessage === "function") {
                // Prepare element with cost data for Kafka
                const elementWithCost = {
                  ...qtoElement,
                  project: projectName,
                  cost_unit: kennwert,
                  cost: elementTotalCost,
                  ebkph: ebkpCode,
                  is_structural:
                    qtoElement.properties?.structuralRole === "load_bearing" ||
                    false,
                  fire_rating: qtoElement.properties?.fireRating || "",
                  category:
                    qtoElement.category ||
                    qtoElement.properties?.category ||
                    "",
                  level: qtoElement.level || qtoElement.properties?.level || "",
                  element_id: qtoElementId,
                  id: qtoElementId,
                };

                // Send to Kafka
                sendKafkaMessage(elementWithCost).catch((err) => {
                  console.error(
                    `Error sending Kafka message for element ${qtoElementId}:`,
                    err
                  );
                });
              }
            }
          });
        }
      } else {
        // Track EBKP codes that didn't match any elements
        unmatchedEbkpCodes.push(ebkpCode);
      }
    });

    // Now create costElements entries - only one per QTO element
    const costElementsToSave = [];

    // Process the map of QTO elements with cost data
    for (const [qtoElementId, costData] of processedQtoElements.entries()) {
      // Find the QTO element
      const qtoElement = existingElements.find(
        (e) => e._id.toString() === qtoElementId
      );

      if (qtoElement) {
        // Create the costElement document
        const costElementDoc = {
          // Use the QTO element as the base
          ...qtoElement,

          // Generate a new ID for this collection
          _id: new ObjectId(),

          // Reference to original QTO element
          qto_element_id: qtoElement._id,

          // Add cost data without changing the structure
          unit_cost: costData.unit_cost,
          total_cost: costData.total_cost,
          currency: costData.currency,

          // Add cost data to properties
          properties: {
            ...qtoElement.properties,
            cost_data: {
              unit_cost: costData.unit_cost,
              total_cost: costData.total_cost,
              source: costData.source,
              timestamp: costData.timestamp,
            },
          },

          // Update timestamps
          qto_created_at: qtoElement.created_at,
          qto_updated_at: qtoElement.updated_at,
          created_at: new Date(),
          updated_at: new Date(),
        };

        costElementsToSave.push(costElementDoc);
      }
    }

    // Log how many elements were matched/unmatched
    console.log(`Matched ${matchedElements.size} elements with eBKP codes`);
    if (unmatchedEbkpCodes.length > 0) {
      console.log(
        `${
          unmatchedEbkpCodes.length
        } eBKP codes did not match any existing elements: ${unmatchedEbkpCodes
          .slice(0, 5)
          .join(", ")}${unmatchedEbkpCodes.length > 5 ? "..." : ""}`
      );
    }

    // Log what we're about to save
    console.log(
      `Prepared ${costElementsToSave.length} cost elements for saving from QTO elements`
    );

    if (costElementsToSave.length > 0) {
      console.log(
        `Sample cost element: ${JSON.stringify(costElementsToSave[0], null, 2)}`
      );
    }

    // Delete existing cost elements for this project
    console.log(`Deleting existing cost elements for project ${projectId}`);
    const deleteElementsResult = await costDatabase
      .collection("costElements")
      .deleteMany({ project_id: projectId });
    console.log(
      `Deleted ${deleteElementsResult.deletedCount} existing cost elements`
    );

    // Insert new cost elements
    if (costElementsToSave.length > 0) {
      console.log(`Inserting ${costElementsToSave.length} cost elements`);
      const costElementsResult = await costDatabase
        .collection("costElements")
        .insertMany(costElementsToSave);
      console.log(
        `Successfully inserted ${costElementsResult.insertedCount} cost elements`
      );
    }

    // Update QTO elements with cost data
    if (elementOps.length > 0) {
      console.log(`Updating ${elementOps.length} QTO elements with cost data`);
      const elemsResult = await qtoDatabase
        .collection("elements")
        .bulkWrite(elementOps);
      console.log(
        `Elements result: ${elemsResult.matchedCount} matched, ${elemsResult.modifiedCount} modified, ${elemsResult.upsertedCount} upserted`
      );
    }

    // Update project summary
    await updateProjectCostSummary(projectId);
    return {
      modifiedCount: elementOps.length,
      insertedCount: costElementsToSave.length,
      projectId: projectId,
    };
  } catch (error) {
    console.error("Error saving cost data batch:", error);
    throw error;
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
  ObjectId,
};
