# Global ID Migration - Complete Implementation

## Overview
This document summarizes the implementation of using `global_id` consistently throughout the Cost and QTO plugins, without requiring database schema migration.

## Strategy
- **Dual Field Support**: Backend supports both `element_id` (legacy) and `global_id` (new) fields
- **No Migration Required**: Existing data continues to work with `element_id`
- **Forward Compatible**: All new data uses `global_id` exclusively
- **Backward Compatible**: Old data with `element_id` still accessible

## Changes Implemented

### 1. Backend Type Updates (`plugin-cost/backend/types.ts`)
- Added `global_id?: string` field to `CostData` interface
- Kept `element_id?: ObjectId` for backward compatibility
- `CostDataKafka` interface retains `id` field for Kafka consumer compatibility (internal mapping from `global_id`)

### 2. MongoDB Operations (`plugin-cost/backend/mongodb.ts`)
- `getCostDataForElement()`: Now searches both `global_id` and `element_id` fields
- `getCostDataForElements()`: Uses `$or` query to find by either field
- Kafka message creation: Uses `global_id` exclusively for all messages
- New cost data: Only writes `global_id` field (not `element_id`)

### 3. API Endpoints (`plugin-cost/backend/server.ts`)
- `/confirm-costs`: Validates `global_id` field
- Supports old `id` field during transition (maps to `global_id`)
- Ensures all Kafka messages use `global_id`

### 4. Frontend Updates
- **MainPage.tsx**: Sends `global_id` instead of `id` in cost data payload
- **ApiContext.tsx**: Maps element data to use `global_id` consistently
- **KafkaElementCost interface**: Changed from `id` to `global_id`

### 5. Database Indexes
- **plugin-cost/mongo-init.js**: Added `global_id` indexes for `costData` and `costElements`
- **plugin-qto/backend/init-mongo.js**: Added `global_id` indexes for QTO and Cost collections
- Kept existing `element_id` indexes for backward compatibility

## Data Flow
1. **QTO → Cost**: QTO elements always have `global_id`
2. **Cost Processing**: Reads both `global_id` and `element_id`, writes only `global_id`
3. **Cost → Kafka**: Always sends `global_id` in messages
4. **Legacy Data**: Still accessible via `element_id` queries

## Benefits
- ✅ No database migration required
- ✅ No downtime during deployment
- ✅ Backward compatible with existing data
- ✅ Clean, consistent field naming going forward
- ✅ Type-safe implementation

## Deployment Steps
1. Deploy backend changes (supports both fields)
2. Deploy frontend changes (sends `global_id`)
3. Monitor for any issues
4. All new data will use `global_id` automatically

## Future Cleanup (Optional)
After all legacy data expires or is no longer needed:
- Remove `element_id` field from TypeScript interfaces
- Remove `element_id` from MongoDB queries
- Drop `element_id` indexes
- Simplify query logic to use only `global_id`

## Testing Checklist
- [ ] QTO elements with `global_id` are correctly processed
- [ ] Cost calculations work with new `global_id` field
- [ ] Kafka messages contain `global_id`
- [ ] Legacy data with `element_id` is still accessible
- [ ] Frontend sends correct field names
- [ ] No TypeScript compilation errors
- [ ] MongoDB queries are performant with new indexes


