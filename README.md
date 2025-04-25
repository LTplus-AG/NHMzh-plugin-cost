# 💰 NHMzh Plugin Cost

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933.svg?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![WebSockets](https://img.shields.io/badge/WebSockets-010101.svg?style=for-the-badge&logo=socket.io)](https://socket.io/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248.svg?style=for-the-badge&logo=mongodb)](https://www.mongodb.com/)
[![Kafka](https://img.shields.io/badge/Kafka-231F20.svg?style=for-the-badge&logo=apache-kafka)](https://kafka.apache.org/)
[![Version](https://img.shields.io/badge/Version-1.0.0-brightgreen.svg?style=for-the-badge)](https://github.com/LTplus-AG/NHMzh-plugin-cost)

A cost calculation module for the Sustainability Monitoring System for the City of Zurich (Nachhaltigkeitsmonitoring der Stadt Zürich), allowing extraction of cost data from Excel files and applying it to BIM elements.

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Kafka Topics](#-kafka-topics)
- [Data Models](#-data-models)
- [API Endpoints](#-api-endpoints)
- [WebSocket Events](#-websocket-events)
- [Integration](#-integration)
- [Tech Stack](#-tech-stack)
- [License](#-license)

## ✨ Features

- **WebSocket Backend**: Real-time communication with frontend
- **Kafka Integration**: Receives elements from QTO plugin and publishes cost calculations
- **Excel Upload**: Import unit costs from Excel files
- **MongoDB Integration**: Persistent storage of cost data
- **Cost Calculation**: Automatically calculate costs based on element areas and unit costs
- **Project Summaries**: Calculate and store project-level cost summaries
- **Integration with NHMzh Ecosystem**: Works with QTO and LCA modules

## 🔧 Architecture

### Backend

- **WebSocket Server**: Built with Node.js and Socket.IO for real-time communication
- **Kafka Consumer**: Listens for element updates from the QTO plugin
- **Kafka Producer**: Publishes cost calculations for consumption by other modules
- **MongoDB Connector**: Handles database operations for storing and retrieving cost data
- **Excel Parser**: Extracts unit cost data from uploaded Excel spreadsheets

### Frontend

- **React/TypeScript** with a component-based architecture
- **Excel Upload Component**: For importing unit costs
- **Cost Table**: Interactive display of costs with filtering capabilities
- **EBKP Structure View**: Hierarchical cost breakdown by building element classification
- **Project Summary Dashboard**: Visualizes total costs and breakdowns by category

### Data Flow

1. Elements are received from the QTO plugin
2. Unit costs are imported by users through Excel upload
3. Costs are calculated by matching elements with appropriate unit costs
4. Results are stored in MongoDB and published to Kafka
5. Other modules (e.g., Dashboard) can retrieve and use cost data

## 🚀 Installation

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for development)

### Setup

The plugin-cost module is designed to integrate with the main NHMzh docker-compose environment. It relies on the shared MongoDB and Kafka services defined in the root docker-compose.yml.

1. Clone the repository:

```bash
git clone https://github.com/LTplus-AG/NHMzh-plugin-cost.git
cd NHMzh-plugin-cost
```

2. Run the entire NHMzh environment:

```bash
docker-compose up -d
```

For local development outside Docker:

```bash
cd NHMzh-plugin-cost
npm install
npm run dev

cd socket-backend
npm install
npm run dev
```

## 📡 Kafka Topics

The Cost plugin's Kafka integration:

- **Consumes** element data from the QTO plugin
- **Publishes** enhanced elements with cost information 

When cost calculations are performed, the plugin sends enhanced element data with cost fields:

```json
{
  "id": "element-id",
  "element_id": "element-id",
  "project": "Project Name",
  "filename": "model.ifc",
  "cost_unit": 100,
  "cost": 1000
  // Original element properties from QTO are spread here
}
```

The message includes the original element properties from QTO with the addition of cost-specific fields, allowing downstream systems to use both geometric and cost data together.

## 💾 Data Models

The plugin uses the shared MongoDB instance for persistent storage of cost data. The following collections are created in the `cost` database:

### Cost Data Schema

```javascript
{
  element_id: ObjectId,     // Reference to element in QTO database
  project_id: ObjectId,     // Reference to project in QTO database
  unit_cost: Number,        // Cost per unit area
  total_cost: Number,       // Total cost for the element
  currency: String,         // Currency (default: CHF)
  calculation_date: Date,   // When cost was calculated
  calculation_method: String, // How cost was calculated
  metadata: {
    ebkp_code: String,      // EBKP classification code
    source: String          // Source of the cost data
  }
}
```

### Cost Summary Schema

```javascript
{
  project_id: ObjectId,     // Reference to project
  total_cost: Number,       // Total project cost
  breakdown: [              // Breakdown by EBKP category
    {
      category: String,     // EBKP category (e.g., "C")
      cost: Number          // Total cost for this category
    }
  ],
  created_at: Date,         // When summary was created
  calculation_parameters: {
    method: String,         // Calculation method
    currency: String        // Currency
  }
}
```

## 🔌 API Endpoints

The WebSocket backend provides the following HTTP endpoints:

- `GET /` or `/health`: Health check and status
- `GET /elements`: List of all elements
- `GET /elements/ebkph/:code`: Elements filtered by EBKP code
- `GET /elements/project/:id`: Elements filtered by project
- `GET /project-cost/:id`: Cost summary for a project
- `GET /element-cost/:id`: Cost data for a specific element
- `GET /costs`: Available unit costs
- `GET /reapply_costs`: Recalculate costs for all elements

## 📡 WebSocket Events

The WebSocket server handles the following events:

- `connection`: Sent when client connects
- `unit_costs`: Client uploads cost data from Excel
- `cost_match_info`: Server informs about cost matches
- `element_update`: Server informs about new elements
- `cost_data_response`: Server response to Excel upload

## 🔗 Integration

The Cost plugin integrates with other NHMzh modules:

- **QTO Plugin**: Receives element data and quantities via Kafka (see [NHMzh-plugin-qto](https://github.com/LTplus-AG/NHMzh-plugin-qto))
- **LCA Plugin**: Sends cost data for economic-environmental assessments (see [NHMzh-plugin-lca](https://github.com/LTplus-AG/NHMzh-plugin-lca))
- **Central Database**: Uses shared MongoDB for data persistence

## 🛠️ Tech Stack

- **Node.js** - Server-side JavaScript runtime
- **WebSockets** - Real-time communication
- **MongoDB** - Document database
- **Kafka** - Message broker
- **Docker** - Containerization

## 📄 License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

GNU Affero General Public License v3.0 (AGPL-3.0): This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See <https://www.gnu.org/licenses/agpl-3.0.html> for details.
