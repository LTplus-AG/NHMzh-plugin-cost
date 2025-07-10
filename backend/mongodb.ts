import { MongoClient, ObjectId, Db, Collection, InsertOneResult, UpdateResult, DeleteResult } from "mongodb";
import logger from './logger';
import { config } from './config';
import {
  ElementData,
  QtoElement,
  CostResult,
  CostData,
  CostElement,
  CostSummary,
  Project,
  Kennwerte,
  EnhancedCostItem,
  CostDataKafka,
  KafkaMetadata,
  ProjectResponse,
  CostElementsResponse,
  CostElementsByEbkpResponse,
  SaveCostDataBatchResult
} from './types';

// Use the MongoDB URI from config
const mongoUri = config.mongodb.uri;
const MONGODB_DATABASE = config.mongodb.costDatabase;
const MONGODB_QTO_DATABASE = config.mongodb.qtoDatabase;

let client: MongoClient | null = null;
let costDb: Db | null = null;
let qtoDb: Db | null = null;
let connectionRetries = 0;
const MAX_RETRIES = parseInt(process.env.MONGODB_CONNECT_MAX_RETRIES || "5");
const RETRY_DELAY_MS = 3000; // Wait 3 seconds between retries

/**
 * Connect to MongoDB and initialize database references
 */
export async function connectToMongoDB(): Promise<void> {
  if (client) {
    try {
      // Test if the client is still connected
      await client.db("admin").command({ ping: 1 });
      return;
    } catch {
      // Connection is dead, proceed with reconnection
      client = null;
    }
  }

  try {
    client = new MongoClient(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    await client.connect();
    
    // Initialize database references
    costDb = client.db(MONGODB_DATABASE);
    qtoDb = client.db(MONGODB_QTO_DATABASE);
    
    logger.info(
      `Connected to MongoDB at ${mongoUri.split("@")[1] || mongoUri}`
    );
  } catch (error) {
    logger.error(
      `Failed to connect to MongoDB at ${
        mongoUri.split("@")[1] || mongoUri
      }:`,
      error
    );
    throw error;
  }
}

/**
 * Initialize collections and create indexes
 */
export async function initializeCollections(): Promise<void> {
  try {
    if (!costDb || !qtoDb) {
      throw new Error("Database connections not initialized");
    }

    const costCollectionNames = await costDb.listCollections().toArray();
    const qtoCollectionNames = await qtoDb.listCollections().toArray();

    // Ensure required collections exist in QTO database
    if (!qtoCollectionNames.some((c) => c.name === "elements")) {
      await qtoDb.createCollection("elements");
    }
    if (!qtoCollectionNames.some((c) => c.name === "projects")) {
      await qtoDb.createCollection("projects");
    }

    // Create CostData collection if it doesn't exist
    if (!costCollectionNames.some((c) => c.name === "costData")) {
      await costDb.createCollection("costData");
    }

    // Create CostSummaries collection if it doesn't exist
    if (!costCollectionNames.some((c) => c.name === "costSummaries")) {
      await costDb.createCollection("costSummaries");
    }
    // Create CostElements collection if it doesn't exist
    if (!costCollectionNames.some((c) => c.name === "costElements")) {
      await costDb.createCollection("costElements");
    }
  } catch (error) {
    logger.error("Error initializing collections:", error);
  }
}

/**
 * Close the MongoDB connection
 */
export async function closeMongoDB(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch (error) {
      logger.error("Error closing MongoDB connection:", error);
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
export async function ensureConnection(): Promise<{ client: MongoClient; costDb: Db; qtoDb: Db }> {
  if (!client) {
    await connectToMongoDB();
  } else {
    try {
      // Test the connection
      await client.db("admin").command({ ping: 1 });
    } catch (error: any) {
      logger.error(
        "MongoDB connection check failed, attempting to reconnect:",
        error.message
      );
      await closeMongoDB(); // Close the potentially broken client

      // Try to reconnect using the function with retry logic
      try {
        await connectToMongoDB();
      } catch (reconnectError: any) {
        // If reconnection (with retries) fails, throw a specific error
        logger.error(
          "Failed to reconnect to MongoDB after retries:",
          reconnectError
        );
        throw new Error(
          `Database connection lost and could not reconnect: ${reconnectError.message}`
        );
      }
    }
  }

  // Initialize database references if they're null
  if (!costDb || !qtoDb || !client) {
    throw new Error("Failed to initialize database connections");
  }
  
  costDb = client.db(MONGODB_DATABASE);
  qtoDb = client.db(MONGODB_QTO_DATABASE);
  
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
export async function saveCostData(elementData: ElementData, costResult: CostResult): Promise<{ elementId: ObjectId; projectId: ObjectId; result: InsertOneResult<CostData> }> {
  await ensureConnection();

  try {
    if (!costDb || !qtoDb) {
      throw new Error("Database connections not initialized");
    }

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
    const costData: CostData = {
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

    // Insert the cost data as a new document instead of updating
    const result = await costDb.collection<CostData>("costData").insertOne(costData);

    // Save to costElements collection
    // First, get the full QTO element data to ensure we have all details
    const qtoElement = await qtoDb.collection<QtoElement>("elements").findOne({
      _id: elementId,
    });

    if (qtoElement) {
      // Calculate total cost based on element's quantity/area
      const elementArea =
        qtoElement.original_area ||
        qtoElement.quantity ||
        (qtoElement.properties?.area as number) ||
        elementData.area ||
        0;
      const elementTotalCost = (costResult.unitCost || 0) * (typeof elementArea === 'number' ? elementArea : 0);

      // Create a document that preserves the QTO element structure exactly
      // but adds cost data
      const costElementDoc: CostElement = {
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

      // First delete any existing entries for this QTO element to avoid duplicates
      await costDb
        .collection("costElements")
        .deleteMany({ qto_element_id: elementId });

      // Then insert the new costElement document
      await costDb.collection<CostElement>("costElements").insertOne(costElementDoc);
    } else {
      logger.warn(
        `QTO element with ID ${elementId} not found, skipping costElements update`
      );
    }

    // Update the project cost summary
    await updateProjectCostSummary(projectId);

    return { elementId, projectId, result };
  } catch (error) {
    logger.error("Error saving cost data:", error);
    throw error; // Throw the error to handle it in the calling function
  }
}

/**
 * Get element data from QTO database
 */
export async function getQtoElement(elementId: string): Promise<QtoElement | null> {
  await ensureConnection();

  try {
    if (!qtoDb) {
      throw new Error("QTO database not initialized");
    }
    return await qtoDb.collection<QtoElement>("elements").findOne({
      _id: new ObjectId(elementId),
    });
  } catch (error) {
    logger.error("Error getting QTO element:", error);
    return null;
  }
}

/**
 * Get elements by project ID
 */
export async function getElementsByProject(projectId: string): Promise<QtoElement[]> {
  await ensureConnection();

  try {
    if (!qtoDb) {
      throw new Error("QTO database not initialized");
    }
    const allElements = await qtoDb
      .collection<QtoElement>("elements")
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
      logger.info(
        `Skipped ${pendingCount} QTO elements with pending status for project ${projectId}`
      );
    }

    return allElements;
  } catch (error) {
    logger.error("Error getting elements by project:", error);
    return [];
  }
}

/**
 * Get cost data for an element
 */
export async function getCostDataForElement(elementId: string): Promise<CostData | null> {
  await ensureConnection();

  try {
    if (!costDb) {
      throw new Error("Cost database not initialized");
    }
    return await costDb.collection<CostData>("costData").findOne({
      element_id: new ObjectId(elementId),
    });
  } catch (error) {
    logger.error("Error getting cost data for element:", error);
    return null;
  }
}

/**
 * Update project cost summary
 */
export async function updateProjectCostSummary(projectId: ObjectId | string): Promise<CostSummary | { error: string }> {
  await ensureConnection();

  try {
    if (!costDb) {
      throw new Error("Cost database not initialized");
    }

    // Handle ObjectId conversion safely
    let projectObjId: ObjectId;
    try {
      projectObjId =
        typeof projectId === "string" ? new ObjectId(projectId) : projectId;
    } catch (error) {
      logger.error(`Invalid project ID format: ${projectId}`, error);
      return { error: `Invalid project ID format: ${projectId}` };
    }

    // Get the costElements - these should be the single source of truth
    // This avoids double-counting that might happen when combining costElements and costData
    const costElements = await costDb
      .collection<CostElement>("costElements")
      .find({
        project_id: projectObjId,
      })
      .toArray();

    // Get costData count for reference only
    const costDataCount = await costDb.collection("costData").countDocuments({
      project_id: projectObjId,
    });

    if (costElements.length === 0) {
      const summary: CostSummary = {
        project_id: projectObjId,
        elements_count: 0,
        cost_data_count: costDataCount,
        total_from_cost_data: 0,
        total_from_elements: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };
      return summary;
    }

    // Create a map of element IDs to prevent double counting in hierarchical elements
    const processedElementIds = new Set<string>();

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
    const summary: CostSummary = {
      project_id: projectObjId,
      elements_count: costElements.length,
      cost_data_count: costDataCount,
      total_from_cost_data: costDataTotal,
      total_from_elements: totalFromElements,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Log the summary for debugging
    logger.info(`Project cost summary for ${projectId}:`, {
      elements_count: summary.elements_count,
      cost_data_count: summary.cost_data_count,
      total_from_elements: summary.total_from_elements,
      total_from_cost_data: summary.total_from_cost_data,
    });

    const result = await costDb
      .collection<CostSummary>("costSummaries")
      .updateOne(
        { project_id: projectObjId },
        { $set: summary },
        { upsert: true }
      );

    return summary;
  } catch (error: any) {
    logger.error("Error updating project cost summary:", error);
    return { error: `Failed to update project summary: ${error.message}` };
  }
}

/**
 * Get all elements for a project
 */
export async function getAllElementsForProject(projectName: string): Promise<any[]> {
  await ensureConnection();

  try {
    if (!qtoDb || !costDb) {
      throw new Error("Database connections not initialized");
    }

    logger.info(`Looking up project elements by name: ${projectName}`);
    let elements: any[] = [];

    // First, check if qtoDb has a projects collection where we can find the project ID
    try {
      const projectsCollection = await qtoDb
        .listCollections({ name: "projects" })
        .toArray();

      if (projectsCollection.length > 0) {
        // Projects collection exists in QTO database
        const project = await qtoDb.collection<Project>("projects").findOne({
          name: { $regex: new RegExp(`^${projectName}$`, "i") },
        });

        if (project) {
          // Look up elements using the project ID
          elements = await qtoDb
            .collection<QtoElement>("elements")
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
            logger.info(
              `Skipped ${pendingCount} QTO elements with pending status for project ${projectName}`
            );
          }
        }
      }
    } catch (error: any) {
      logger.warn(
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

            if (foundElements.length > 0) {
              elements = foundElements;
              break;
            }
          } catch (err) {
            logger.error(
              `Error with search query ${JSON.stringify(searchQuery)}:`,
              err
            );
          }
        }
      }
    }

    // If still no elements, return empty array
    if (elements.length === 0) {
      return [];
    }

    // Get cost data for these elements
    const elementIds = elements.map((e) => e._id);
    const costData = await costDb
      .collection<CostData>("costData")
      .find({
        element_id: { $in: elementIds },
      })
      .toArray();

    // Create a map of cost data by element ID for quick lookup
    const costDataMap: Record<string, CostData> = {};
    costData.forEach((cost) => {
      if (cost.element_id) {
        costDataMap[cost.element_id.toString()] = cost;
      }
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
    logger.error("Error getting all elements for project:", error);
    return [];
  }
}

/**
 * Get cost elements by project ID
 * This returns elements from the costElements collection which combines QTO and cost data
 */
export async function getCostElementsByProject(projectName: string): Promise<CostElementsResponse> {
  await ensureConnection();

  try {
    if (!qtoDb || !costDb) {
      throw new Error("Database connections not initialized");
    }

    // First find the project ID
    const project = await qtoDb.collection<Project>("projects").findOne({
      name: { $regex: new RegExp(`^${projectName}$`, "i") },
    });

    if (!project) {
      logger.warn(`Project not found with name: ${projectName}`);
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

    // Get cost elements for this project
    const costElements = await costDb
      .collection<CostElement>("costElements")
      .find({
        project_id: projectId,
        qto_status: "active", // Only include cost elements for active QTO elements
      })
      .toArray();

    // Compute summary statistics
    // Look for EBKP code in properties.classification.id or properties.ebkph
    const ebkpCodes = new Set<string>();
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
      (sum, element) => sum + (element.original_area || (typeof element.quantity === 'number' ? element.quantity : 0) || 0),
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
    logger.error("Error getting cost elements by project:", error);
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
export async function getCostElementsByEbkpCode(ebkpCode: string): Promise<CostElementsByEbkpResponse> {
  await ensureConnection();

  try {
    if (!costDb || !qtoDb) {
      throw new Error("Database connections not initialized");
    }

    // Find elements where either properties.classification.id or properties.ebkph match
    const costElements = await costDb
      .collection<CostElement>("costElements")
      .find({
        $or: [
          { "properties.classification.id": ebkpCode },
          { "properties.ebkph": ebkpCode },
        ],
      })
      .toArray();

    // Compute summary statistics
    const projectIds = new Set(
      costElements.map((element) => element.project_id.toString())
    );
    const projects: Array<{ id: string; name: string }> = [];

    for (const projectId of projectIds) {
      try {
        const project = await qtoDb.collection<Project>("projects").findOne({
          _id: new ObjectId(projectId),
        });
        if (project) {
          projects.push({
            id: projectId,
            name: project.name || "Unknown Project",
          });
        }
      } catch (error) {
        logger.warn(`Could not find project with ID ${projectId}`);
      }
    }

    // Calculate total area using quantity or original_area
    const totalArea = costElements.reduce(
      (sum, element) => sum + (element.original_area || (typeof element.quantity === 'number' ? element.quantity : 0) || 0),
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
    logger.error("Error getting cost elements by EBKP code:", error);
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
function normalizeEbkpCode(code: string | null | undefined): string | null | undefined {
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
    return normalized; // Return space-removed, uppercase version if not standard format
  }

  return normalized;
}

/**
 * Save a batch of cost data (Refactored Logic)
 * Creates costElements entries based on active QTO elements and existing costData.
 */
export async function saveCostDataBatch(
  costItems: EnhancedCostItem[],
  allExcelItems: EnhancedCostItem[],
  projectName: string,
  sendKafkaMessage?: ((elements: CostDataKafka[], metadata: KafkaMetadata) => Promise<{ success: boolean; count: number }>) | null
): Promise<SaveCostDataBatchResult> {
  try {
    const { costDb: costDatabase, qtoDb: qtoDatabase } = await ensureConnection();

    const qtoProject = await qtoDatabase.collection<Project>("projects").findOne(
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
      logger.warn(
        `Project ${projectName} not found. Cannot update cost elements.`
      );
      return { 
        insertedCount: 0, 
        deletedCostElements: 0,
        processedBimElements: 0,
        skippedBimElements: 0,
        processedExcelOnlyItems: 0,
        insertedCostElements: 0,
        projectId: new ObjectId(),
        kafkaSent: 0
      } as SaveCostDataBatchResult;
    }
    const projectId = qtoProject._id;

    // Extract required metadata for Kafka
    const originalTimestamp = qtoProject.metadata?.upload_timestamp;
    let kafkaMetadata: KafkaMetadata | null = null;
    if (!originalTimestamp) {
      logger.error(
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
      logger.warn(
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
    }

    // 2. Delete existing cost elements
    const deleteResult = await costDatabase
      .collection("costElements")
      .deleteMany({ project_id: projectId });

    // 3. Create lookup map for BIM-matched costItems
    const mappedCostItemsLookup = new Map<string, EnhancedCostItem>();
    (costItems || []).forEach((item) => {
      if (item.ebkp) {
        const normalized = normalizeEbkpCode(item.ebkp);
        if (normalized) {
          mappedCostItemsLookup.set(normalized, item);
        }
      }
    });

    // 4. Fetch only active QTO elements for the project
    const activeQtoElements = await qtoDatabase
      .collection<QtoElement>("elements")
      .find({ project_id: projectId, status: "active" })
      .toArray();

    // 5. Fetch costData map
    const costDataMap = new Map<string, CostData>();
    const projectCostData = await costDatabase
      .collection<CostData>("costData")
      .find({ project_id: projectId })
      .toArray();
    projectCostData.forEach((doc) => {
      if (doc.ebkp_code) {
        const normalized = normalizeEbkpCode(doc.ebkp_code);
        if (normalized) {
          costDataMap.set(normalized, doc);
        }
      }
    });

    // 6. Process QTO elements (BIM-derived elements)
    const costElementsToSave: CostElement[] = [];
    const elementsForKafka: CostDataKafka[] = [];
    const ebkpCodesSuccessfullyAddedFromBim = new Set<string>(); // Track EBKPs with actual cost from BIM
    const processedKafkaIds = new Set<string>(); // Track IDs added to Kafka (can be QTO ID or costData ID)
    let processedBimCount = 0;
    let skippedBimCount = 0;

    for (const qtoElement of activeQtoElements) {
      const qtoElementEbkpCode = getElementEbkpCode(qtoElement);
      const normalizedQtoEbkp = qtoElementEbkpCode
        ? normalizeEbkpCode(qtoElementEbkpCode)
        : null;
      if (!normalizedQtoEbkp) {
        skippedBimCount++;
        continue;
      }

      // Find the corresponding costData document using the normalized EBKP code
      const costDataForElement = costDataMap.get(normalizedQtoEbkp);

      // Check if costData exists and has a valid unit cost
      if (costDataForElement && costDataForElement.unit_cost > 0) {
        // Calculate cost based on QTO element quantity and costData unit cost
        let elementQuantity = 0;
        // Prioritize specific quantity types if available
        const qty = qtoElement.quantity;
        if (typeof qty === 'object' && qty !== null && 'type' in qty && 'value' in qty) {
          if (qty.type === "Area" && qty.value !== undefined) {
            elementQuantity = qty.value;
          } else if (qty.value !== undefined) {
            elementQuantity = qty.value;
          }
        } else if (qtoElement.area !== undefined) {
          elementQuantity = qtoElement.area;
        } else if (typeof qtoElement.quantity === "number") {
          elementQuantity = qtoElement.quantity;
        } else if (qtoElement.volume !== undefined) {
          elementQuantity = qtoElement.volume;
        } else if (qtoElement.length !== undefined) {
          elementQuantity = qtoElement.length;
        }

        const unitCost = costDataForElement.unit_cost;
        const elementTotalCost = unitCost * elementQuantity;

        // Only add to Kafka and mark EBKP if cost is > 0
        if (elementTotalCost > 0) {
          ebkpCodesSuccessfullyAddedFromBim.add(normalizedQtoEbkp);

          // Create the costElement document for saving to DB
          const costElementDoc: CostElement = {
            ...qtoElement,
            _id: new ObjectId(), // Override the _id from qtoElement
            qto_element_id: qtoElement._id,
            qto_status: qtoElement.status || "active",
            project_id: projectId,
            unit_cost: unitCost,
            total_cost: elementTotalCost,
            currency: "CHF",
            ebkp_code: qtoElementEbkpCode || undefined,
            properties: {
              ...qtoElement.properties,
              cost_data: {
                unit_cost: unitCost,
                total_cost: elementTotalCost,
                source: "qto+costdata",
                timestamp: new Date(),
              },
            },
            qto_created_at: qtoElement.created_at,
            qto_updated_at: qtoElement.updated_at,
            created_at: new Date(),
            updated_at: new Date(),
          };
          costElementsToSave.push(costElementDoc);

          // Add to Kafka list using QTO element's ID
          const kafkaMessageElementId =
            qtoElement.global_id || qtoElement._id.toString();
          if (!processedKafkaIds.has(kafkaMessageElementId)) {
            elementsForKafka.push({
              id: kafkaMessageElementId,
              cost: elementTotalCost,
              cost_unit: unitCost,
            });
            processedKafkaIds.add(kafkaMessageElementId);
          }
          processedBimCount++;
        } else {
          // BIM element matched but resulted in zero cost
          skippedBimCount++;
        }
      } else {
        // No costData found or unit cost is zero
        skippedBimCount++;
      }
    }

    // 7. Process Excel items (Leaf nodes ONLY) for Kafka
    let processedExcelOnlyCount = 0;
    let totalExcelCost = 0; // Cost added from Excel leaves
    let missingCostDataCount = 0;

    if (allExcelItems && Array.isArray(allExcelItems)) {
      // Define getAllItemsFlat locally if not imported
      const getAllItemsFlat = (items: EnhancedCostItem[]): EnhancedCostItem[] => {
        let r: EnhancedCostItem[] = [];
        items.forEach((i) => {
          r.push(i);
          if (i.children?.length) r = r.concat(getAllItemsFlat(i.children));
        });
        return r;
      };
      const flatExcelItems = getAllItemsFlat(allExcelItems);

      // Process only leaf nodes from Excel
      for (const excelItem of flatExcelItems) {
        // Skip if it has children (not a leaf node)
        if (excelItem.children && excelItem.children.length > 0) continue;

        const excelEbkp = excelItem.ebkp;
        if (!excelEbkp) continue;

        const normalizedExcelEbkp = normalizeEbkpCode(excelEbkp);
        if (!normalizedExcelEbkp) continue;

        if (ebkpCodesSuccessfullyAddedFromBim.has(normalizedExcelEbkp)) {
          continue;
        }

        // Get cost directly from Excel leaf item
        const itemCostValue =
          parseFloat(String(excelItem.chf || excelItem.totalChf || 0)) || 0;
        if (itemCostValue <= 0) continue; // Skip zero-cost leaves

        totalExcelCost += itemCostValue;

        // Find or Create corresponding costData entry for this leaf item
        let costDataDoc = costDataMap.get(normalizedExcelEbkp);
        let costDataId: string;

        if (!costDataDoc) {
          const newCostDataId = new ObjectId();
          const newCostDataDoc: CostData = {
            _id: newCostDataId,
            project_id: projectId,
            ebkp_code: excelEbkp,
            unit_cost: excelItem.kennwert || 0,
            quantity: excelItem.menge || 1, // Use Excel Menge for leaves
            total_cost: itemCostValue,
            currency: "CHF",
            calculation_date: new Date(),
            calculation_method: "excel-import-leaf",
            metadata: {
              source: "excel-import-leaf",
              ebkp_code: excelEbkp,
              timestamp: new Date(),
              original_data: {
                is_parent: false, // It's a leaf node
                bezeichnung: excelItem.bezeichnung || "",
                ebkp_code: excelEbkp,
                normalized_ebkp: normalizedExcelEbkp,
              },
            },
            created_at: new Date(),
            updated_at: new Date(),
          };
          try {
            await costDatabase.collection<CostData>("costData").insertOne(newCostDataDoc);
            costDataMap.set(normalizedExcelEbkp, newCostDataDoc);
            costDataDoc = newCostDataDoc;
            costDataId = newCostDataId.toString();
          } catch (err: any) {
            logger.error(
              `Failed to create costData for Excel LEAF ${excelEbkp}: ${err.message}`
            );
            missingCostDataCount++;
            continue; // Skip if DB insert fails
          }
        } else {
          costDataId = costDataDoc._id.toString();
        }

        // Add leaf Excel item to Kafka using costData ID
        if (costDataId && !processedKafkaIds.has(costDataId)) {
          elementsForKafka.push({
            id: costDataId,
            cost: itemCostValue,
            cost_unit: costDataDoc.unit_cost || excelItem.kennwert || 0,
          });
          processedKafkaIds.add(costDataId);
          processedExcelOnlyCount++;
        }
      }
    }

    let insertResult = { insertedCount: 0 };
    if (costElementsToSave.length > 0) {
      insertResult = await costDatabase
        .collection<CostElement>("costElements")
        .insertMany(costElementsToSave, { ordered: false });
    }

    await updateProjectCostSummary(projectId);

    let kafkaResult = { success: false, count: 0 };
    if (sendKafkaMessage && elementsForKafka.length > 0 && kafkaMetadata) {
      kafkaResult = await sendKafkaMessage(elementsForKafka, kafkaMetadata);
    }

    return {
      deletedCostElements: deleteResult.deletedCount,
      processedBimElements: processedBimCount,
      skippedBimElements: skippedBimCount,
      processedExcelOnlyItems: processedExcelOnlyCount,
      insertedCostElements: insertResult.insertedCount,
      projectId: projectId,
      kafkaSent: kafkaResult?.count || 0,
    };
  } catch (error) {
    logger.error("Error processing cost elements batch:", error);
    throw error;
  }
}

// Create a more lenient way of extracting EBKP from an element
export function getElementEbkpCode(element: any): string | null {
  let ebkpCode = null;

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

  return ebkpCode;
}

/**
 * Get the cost database instance
 */
export function getCostDb(): Db {
  if (!costDb) {
    throw new Error("Cost database not initialized. Call connectToMongoDB first.");
  }
  return costDb;
}

/**
 * Get all projects from QTO database
 */
export async function getAllProjects(): Promise<ProjectResponse[]> {
  await ensureConnection();

  try {
    if (!qtoDb) {
      throw new Error("QTO database not initialized");
    }
    const projects = await qtoDb
      .collection<Project>("projects")
      .find({}, { projection: { _id: 1, name: 1 } })
      .toArray();

    // Map to the expected format { id: string, name: string }
    const formattedProjects = projects.map((p) => ({
      id: p._id.toString(),
      name: p.name || "Unnamed Project", // Provide a default name
    }));

    return formattedProjects;
  } catch (error) {
    logger.error("Error getting all projects:", error);
    return [];
  }
}

/**
 * Get the projects collection from QTO database
 */
export async function getProjectsCollection(): Promise<Collection<Project>> {
  await ensureConnection();
  if (!qtoDb) {
    throw new Error("QTO database not initialized");
  }
  return qtoDb.collection<Project>("projects");
}

/**
 * Get the elements collection from QTO database
 */
export async function getElementsCollection(): Promise<Collection<QtoElement>> {
  await ensureConnection();
  if (!qtoDb) {
    throw new Error("QTO database not initialized");
  }
  return qtoDb.collection<QtoElement>("elements");
}

/**
 * Get the kennwerte collection from cost database
 */
export async function getKennwerteCollection(): Promise<Collection<Kennwerte>> {
  await ensureConnection();
  if (!costDb) {
    throw new Error("Cost database not initialized");
  }
  return costDb.collection<Kennwerte>("kennwerte");
}

/**
 * Get the costElements collection from cost database
 */
export async function getCostElementsCollection(): Promise<Collection<CostElement>> {
  await ensureConnection();
  if (!costDb) {
    throw new Error("Cost database not initialized");
  }
  return costDb.collection<CostElement>("costElements");
}

// Export ObjectId for external use
export { ObjectId };