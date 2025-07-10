import dotenv from 'dotenv';

dotenv.config();

// Ensure authSource=admin is used for MongoDB authentication
let MONGODB_URI = process.env.MONGODB_URI as string;
if (MONGODB_URI && !MONGODB_URI.includes('authSource=')) {
  MONGODB_URI += '?authSource=admin';
} else if (MONGODB_URI && MONGODB_URI.includes('authSource=cost')) {
  MONGODB_URI = MONGODB_URI.replace('authSource=cost', 'authSource=admin');
}

export const config = {
  server: {
    port: parseInt(process.env.HTTP_PORT || '8001'),
  },
  kafka: {
    broker: process.env.KAFKA_BROKER || 'broker:29092',
    costTopic: process.env.KAFKA_COST_TOPIC || 'cost-updates',
  },
  mongodb: {
    uri: MONGODB_URI || 
      `mongodb://${process.env.MONGODB_USERNAME || 'admin'}:${process.env.MONGODB_PASSWORD || 'admin'}@mongodb:27017/?authSource=admin`,
    costDatabase: process.env.MONGODB_COST_DB || 'cost',
    qtoDatabase: process.env.MONGODB_QTO_DB || 'qto',
    collections: {
      costData: process.env.MONGODB_COST_DATA_COLLECTION || 'costData',
      costSummaries: process.env.MONGODB_COST_SUMMARIES_COLLECTION || 'costSummaries',
      costElements: process.env.MONGODB_COST_ELEMENTS_COLLECTION || 'costElements',
      kennwerte: process.env.MONGODB_KENNWERTE_COLLECTION || 'kennwerte',
      unitCost: process.env.MONGODB_UNIT_COST_COLLECTION || 'unit_cost',
    },
    auth: {
      username: process.env.MONGODB_USERNAME || 'admin',
      password: process.env.MONGODB_PASSWORD || 'admin',
    },
  },
};

// Validate required environment variables
if (!config.mongodb.uri) {
  console.error('ERROR: Missing required environment variable: MONGODB_URI');
  throw new Error('Missing required environment variable: MONGODB_URI');
}

console.log(`Cost service configuration:
- HTTP Port: ${config.server.port}
- Kafka Broker: ${config.kafka.broker}
- Cost Topic: ${config.kafka.costTopic}
- MongoDB URI: ${config.mongodb.uri.replace(/:[^:]*@/, ':****@')}
- Cost DB: ${config.mongodb.costDatabase}
- QTO DB: ${config.mongodb.qtoDatabase}
`); 