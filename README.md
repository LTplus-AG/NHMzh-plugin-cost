# 💰 NHMzh Plugin-Cost: Kostenberechnung

[![React](https://img.shields.io/badge/React-18.3-61DAFB.svg?style=for-the-badge&logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF.svg?style=for-the-badge&logo=vite)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-18.x-339933.svg?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248.svg?style=for-the-badge&logo=mongodb)](https://www.mongodb.com/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)

Modul zur Kostenberechnung für das Nachhaltigkeitsmonitoring der Stadt Zürich (NHMzh). Es ermöglicht das Anwenden von Kostenkennwerten (z.B. aus Excel) auf BIM-Daten.

## 📋 Inhaltsverzeichnis

- [Architektur und Datenfluss](#-architektur-und-datenfluss)
- [Funktionsumfang](#-funktionsumfang)
- [Datenbank-Schema](#-datenbank-schema)
- [API-Endpunkte](#-api-endpunkte)
- [Installation](#-installation)
- [Lizenz](#-lizenz)

---

### 🏛️ Architektur und Datenfluss

Das Cost-Plugin ist eine Webanwendung mit einem React/TypeScript-Frontend (Vite) und einem Node.js/Express-Backend.

- **Frontend**: Eine in React/TypeScript entwickelte Oberfläche, die über Vite ausgeliefert wird. Benutzer verwalten Kostenkennwerte pro Projekt (z.B. durch Excel-Upload) und sehen die berechneten Kosten pro Bauteil.
- **Backend**: Ein Express-Server in `backend/`, implementiert in TypeScript. Er stellt die REST-API für alle Operationen bereit und kommuniziert mit Kafka, um freigegebene Kostendaten an nachgelagerte Systeme zu senden.

**Datenfluss:**

1.  **Datenabruf**: Das **Cost-Backend** liest die erforderlichen Bauteildaten (Mengen, eBKP-Codes) **direkt aus der `qto`-Datenbank** des QTO-Plugins ab.
2.  **Kostenkennwerte**: Der Benutzer lädt über das Frontend Kostenkennwerte (CHF/Einheit) pro eBKP-Code, die im Backend verarbeitet werden.
3.  **Kostenberechnung**: Das Backend verknüpft die Bauteile aus der `qto`-Datenbank mit den passenden Kostenkennwerten und berechnet die Gesamtkosten pro Bauteil.
4.  **Datenspeicherung**: Die Ergebnisse werden in einer dedizierten **`cost`-MongoDB-Datenbank** gespeichert, primär in der `costElements`-Sammlung.
5.  **Visualisierung**: Das Frontend ruft die berechneten Kosten vom Backend ab und stellt sie dar.


### ✨ Funktionsumfang

- **Direkte QTO-Integration**: Liest Mengen- und Bauteildaten direkt aus der QTO-Datenbank.
- **Kostenkennwert-Import**: Ermöglicht den Upload von eBKP-basierten Kostenkennwerten aus Excel-Dateien.
- **Automatische Kostenberechnung**: Verknüpft Bauteile mit Kostenkennwerten basierend auf eBKP-Codes und berechnet die Gesamtkosten.
- **Hierarchische Kostendarstellung**: Gruppiert Kosten nach der eBKP-Struktur.
- **REST API**: Bietet strukturierte HTTP-Endpunkte für alle Operationen.
- **Sicherheitsfeatures**: Rate Limiting, Input-Validierung und Timeout-Handling.

### 💾 Datenbank-Schema

Die berechneten Kosten werden in der `cost`-Datenbank gespeichert. Die wichtigste Sammlung ist `costElements`, die eine Kombination aus den QTO-Daten und den angereicherten Kostendaten darstellt.

**`cost.costElements` Beispiel-Dokument:**
```json
{
  "_id": "ObjectId",
  "qto_element_id": "ObjectId", // Referenz zum Original-Element in qto.elements
  "project_id": "ObjectId",
  "global_id": "3DqaUydM99ehywE4_2hm1u",
  "ifc_class": "IfcWall",
  "name": "Aussenwand_470mm",
  "quantity": {
    "value": 125.5,
    "type": "area",
    "unit": "m²"
  },
  "classification": {
    "id": "C2.01",
    "system": "eBKP"
  },
  // --- Angereicherte Kostendaten ---
  "unit_cost": 450.0,
  "total_cost": 56475.0,
  "currency": "CHF",
  "created_at": "ISODate"
}
```

### 📡 API-Endpunkte

Das Backend stellt folgende REST API-Endpunkte bereit:

- **GET `/health`** - Health Check
- **GET `/projects`** - Liste aller Projekte
- **GET `/project-elements/:projectName`** - Alle Elemente eines Projekts
- **GET `/available-ebkp-codes`** - Verfügbare eBKP-Codes
- **GET `/get-kennwerte/:projectName`** - Kostenkennwerte eines Projekts
- **POST `/save-kennwerte`** - Kostenkennwerte speichern
- **POST `/reapply-costs`** - Kostenberechnung neu anstossen
- **POST `/confirm-costs`** - Berechnete Kosten bestätigen und an Kafka senden

Alle Endpunkte verfügen über:
- Rate Limiting (100 Anfragen/15 Min, 20 für Schreiboperationen)
- Input-Validierung
- Fehlerbehandlung
- 30 Sekunden Timeout

### 🚀 Installation

Die Installation und Ausführung erfolgt im Rahmen der gesamten NHMzh-Umgebung via Docker Compose. Für die lokale Entwicklung:

**Frontend (Vite + React/TypeScript):**
```bash
# In das Plugin-Verzeichnis wechseln
cd plugin-cost
# Abhängigkeiten installieren
npm install
# Entwicklungsserver starten
npm run dev
```

**Backend (Express + TypeScript):**
```bash
cd plugin-cost/backend
# Abhängigkeiten installieren
npm install
# Backend-Server starten
npm run dev
```

Das Frontend läuft standardmässig unter `http://localhost:5173`, das Backend unter dem Port, der in `backend/config.ts` konfiguriert ist (Standard: `8004`).

### 🤝 Förderung & Urheberschaft

Dieses Projekt wurde durch die Stadt Zürich finanziert. Der gesamte in diesem Repository enthaltene Quellcode stammt von Louis Trümpler (LTplus AG).

### 📄 Lizenz

Dieses Projekt ist unter der GNU Affero General Public License v3.0 (AGPL-3.0) lizenziert.
