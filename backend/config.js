const dotenv = require('dotenv');
dotenv.config();

const config = {
  server: {
    port: process.env.HTTP_PORT || 8001,
  },
  kafka: {
    broker: process.env.KAFKA_BROKER || 'broker:29092',
    costTopic: process.env.KAFKA_COST_TOPIC || 'cost-updates',
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://admin:admin@mongodb:27017/?authSource=admin',
    costDatabase: process.env.MONGODB_COST_DB || 'cost',
    qtoDatabase: process.env.MONGODB_QTO_DB || 'qto',
  },
};

// Validate required environment variables
if (!process.env.MONGODB_URI) {
  console.error('ERROR: Missing required environment variable: MONGODB_URI');
  process.exit(1);
}

console.log(`Cost service configuration:
- HTTP Port: ${config.server.port}
- Kafka Broker: ${config.kafka.broker}
- Cost Topic: ${config.kafka.costTopic}
- MongoDB URI: ${config.mongodb.uri.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}
- Cost DB: ${config.mongodb.costDatabase}
- QTO DB: ${config.mongodb.qtoDatabase}
`);

module.exports = config; 