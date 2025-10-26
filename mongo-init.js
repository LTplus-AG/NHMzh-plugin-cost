// MongoDB initialization script
//
// The costElements collection represents a combined view of QTO elements with
// their associated cost data. It preserves the exact structure of QTO elements
// and adds cost data (unit_cost, total_cost) from user-uploaded Excel files.
//
// The costSummaries collection stores simplified aggregated cost data with only essential fields:
// - created_at: When the summary was created
// - elements_count: Number of elements in costElements
// - cost_data_count: Number of items in costData
// - total_from_cost_data: Total cost sum from costData collection
// - total_from_elements: Total cost sum from costElements collection
// - updated_at: When the summary was last updated
//
// Unlike costData which stores only cost information, costElements maintains the
// complete QTO element structure with materials, properties, and classification
// data for more comprehensive analysis and reporting.

// Connect to admin database
db = db.getSiblingDB("admin");

// Create admin user with broad privileges NEEDED FOR INITIALIZATION ONLY
// ****** PRODUCTION SECURITY WARNING ******
// After initial deployment and successful execution of this script,
// MANUALLY REVOKE unnecessary roles (like dbAdminAnyDatabase, userAdminAnyDatabase)
// from this admin user, following the principle of least privilege.
// Rely on service-specific users for ongoing operations.
// ****** PRODUCTION SECURITY WARNING ******
db.createUser({
  user: "admin_user",
  pwd: "admin_password",
  roles: [
    { role: "userAdminAnyDatabase", db: "admin" },
    { role: "dbAdminAnyDatabase", db: "admin" },
    { role: "readWriteAnyDatabase", db: "admin" },
  ],
});

// Database names - use environment variables or defaults
const qtoDbName = process.env.MONGODB_QTO_DATABASE || "qto";
const costDbName = process.env.MONGODB_DATABASE || "cost";
const lcaDbName = process.env.MONGODB_LCA_DATABASE || "lca";
const sharedDbName = process.env.MONGODB_SHARED_DATABASE || "shared";

const databases = [qtoDbName, costDbName, lcaDbName, sharedDbName];

// Create databases and collections
databases.forEach((dbName) => {
  db = db.getSiblingDB(dbName);

  if (dbName === "qto") {
    // Create collections for QTO
    db.createCollection("projects");
    db.createCollection("elements");

    // Create indexes
    db.elements.createIndex({ project_id: 1 });
    db.elements.createIndex({ element_type: 1 });
  } else if (dbName === "cost") {
    // Create collections for Cost
    db.createCollection("costData");
    db.createCollection("costSummaries");
    db.createCollection("costElements");

    // Create indexes
    db.costData.createIndex({ element_id: 1 });
    db.costData.createIndex({ global_id: 1 });  // Add new index for global_id
    db.costData.createIndex({ project_id: 1 });
    db.costData.createIndex({ ebkp_code: 1 });

    // Simplified costSummaries indexes
    db.costSummaries.createIndex({ project_id: 1 }, { unique: true });
    db.costSummaries.createIndex({ updated_at: 1 });
    db.costSummaries.createIndex({ total_from_elements: 1 });
    db.costSummaries.createIndex({ total_from_cost_data: 1 });

    db.costElements.createIndex({ element_id: 1 });
    db.costElements.createIndex({ global_id: 1 });  // Add new index for global_id
    db.costElements.createIndex({ ebkp_code: 1 });
    db.costElements.createIndex({ project_id: 1 });
    db.costElements.createIndex({ qto_element_id: 1 });
  } else if (dbName === "lca") {
    // Create collections for LCA
    db.createCollection("lcaResults");
    db.createCollection("materialLibrary");

    // Create indexes
    db.lcaResults.createIndex({ element_id: 1 });
    db.materialLibrary.createIndex({ name: 1 });
  } else if (dbName === "shared") {
    // Create shared collections
    db.createCollection("references");

    // Create indexes
    db.references.createIndex({ reference_type: 1 });
  }
});

// Create service-specific users
db = db.getSiblingDB("admin");

// QTO service user - restricted to only what it needs
db.createUser({
  user: qtoUser,
  pwd: qtoPassword,
  roles: [
    { role: "readWrite", db: qtoDbName },
    { role: "read", db: sharedDbName },
  ],
});

// Cost service user - restricted to only what it needs
db.createUser({
  user: costUser,
  pwd: costPassword,
  roles: [
    { role: "readWrite", db: costDbName },
    { role: "read", db: qtoDbName },
    { role: "read", db: sharedDbName },
  ],
});

// LCA service user - restricted to only what it needs
db.createUser({
  user: lcaUser,
  pwd: lcaPassword,
  roles: [
    { role: "readWrite", db: lcaDbName },
    { role: "read", db: costDbName },
    { role: "read", db: qtoDbName },
    { role: "read", db: sharedDbName },
  ],
});

// Print initialization complete message
print(
  "MongoDB initialization completed: databases, collections, and users created."
);
