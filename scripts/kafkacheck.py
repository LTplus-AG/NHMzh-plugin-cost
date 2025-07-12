#!/usr/bin/env python3
"""
kafkacheck.py - Processes multiple Kafka cost export files and calculates cost totals.

USAGE
    python plugin-cost/scripts/kafkacheck.py <directory_path> <file_pattern>

Example:
    python plugin-cost/scripts/kafkacheck.py "C:/Users/Louistrue/Downloads" "topic-message"    

The script finds all files matching the pattern, extracts the cost data,
and calculates the total cost across all items.
"""

import json
import sys
import os
from collections import defaultdict, Counter
from pathlib import Path
import locale # For formatting currency

def process_file(file_path):
    """Reads a Kafka export file, parses the inner JSON, and returns the data list."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            kafka_message = json.load(f)

        # Handle nested JSON structure - the actual data is in the "Value" field as a JSON string
        if "Value" in kafka_message and isinstance(kafka_message["Value"], str):
            try:
                inner_payload = json.loads(kafka_message["Value"])
                rows = inner_payload.get("data", [])
                if not rows:
                    print(f"Warning: No data rows found in inner JSON of {file_path.name}")
                return rows
            except json.JSONDecodeError:
                print(f"Error: Could not parse inner JSON in {file_path.name}")
                return []
        else:
            print(f"Warning: 'Value' field containing JSON string not found in {file_path.name}. Assuming direct JSON.")
            # Handle case where the file might *already* be the inner payload format
            rows = kafka_message.get("data", [])
            if not rows:
                 print(f"Warning: No data rows found directly in {file_path.name}")
            return rows

    except Exception as e:
        print(f"Error processing {file_path.name}: {str(e)}")
        return []

def main():
    if len(sys.argv) < 3:
        print("ERROR: Missing arguments.")
        sys.exit(__doc__) # Print usage instructions

    directory = Path(sys.argv[1])
    file_pattern = sys.argv[2]

    if not directory.is_dir():
        sys.exit(f"Error: Directory not found: {directory}")

    # Find all matching files
    all_files = []
    print(f"Searching for files matching '{file_pattern}' in '{directory}'...")
    for item in directory.iterdir():
        # Ensure case-insensitive matching for the pattern within the filename
        if item.is_file() and file_pattern.lower() in item.name.lower():
            all_files.append(item)

    if not all_files:
        sys.exit(f"No files matching pattern '{file_pattern}' found in {directory}")

    print(f"\nFound {len(all_files)} files to process:")
    # Sort files numerically if possible (e.g., topic-message, topic-message(1))
    all_files.sort(key=lambda f: f.name)
    for file_path in all_files:
        print(f"- {file_path.name}")

    # Process all files and collect rows
    all_rows = []
    for file_path in all_files:
        print(f"\nProcessing: {file_path.name}...")
        rows = process_file(file_path)
        all_rows.extend(rows)
        print(f"  -> Found {len(rows)} cost items.")

    print(f"\nTotal cost items processed across all files: {len(all_rows)}")

    if not all_rows:
        sys.exit("No cost items found in any processed file.")

    # --- Check for duplicate IDs ---
    all_ids = [row.get("id") for row in all_rows if row.get("id")]
    print("\n=== ID UNIQUENESS CHECK ===")
    if len(all_ids) != len(set(all_ids)):
        print("🔴 Found duplicate IDs!")
        id_counts = Counter(all_ids)
        duplicates = {id: count for id, count in id_counts.items() if count > 1}
        print(f"  - Total items: {len(all_rows)}")
        print(f"  - Total unique IDs: {len(set(all_ids))}")
        print(f"  - Number of duplicate IDs: {len(duplicates)}")
        # Print details for a few duplicates
        for i, (id, count) in enumerate(duplicates.items()):
            if i >= 5:
                print(f"  ... and {len(duplicates) - 5} more.")
                break
            print(f"  - ID '{id}' appears {count} times.")
    else:
        print("✅ All IDs are unique.")
        print(f"  - Total items processed: {len(all_rows)}")


    # Calculate grand total cost
    grand_total_cost = 0.0
    for row in all_rows:
        grand_total_cost += row.get("cost", 0.0)

    # Set locale for currency formatting (e.g., Swiss German)
    try:
        # Use a locale available on most systems, like generic German or English
        # Specific ones like de_CH.UTF-8 might not be installed everywhere
        locale.setlocale(locale.LC_ALL, 'de_DE.UTF-8')
    except locale.Error:
        try:
            locale.setlocale(locale.LC_ALL, 'en_US.UTF-8')
            print("\nWarning: Locale 'de_DE.UTF-8' not available. Using 'en_US.UTF-8' for formatting.")
        except locale.Error:
             print("\nWarning: Could not set German or US locale. Using default system locale for formatting.")
             locale.setlocale(locale.LC_ALL, '') # Use system default

    print("\n=== GRAND TOTAL COST ACROSS ALL FILES ===")
    # Format as currency with grouping (thousands separators)
    formatted_total = locale.format_string("%.2f", grand_total_cost, grouping=True)
    print(f"Total Cost: CHF {formatted_total}") # Assuming CHF currency

    # --- Optional: Breakdown by Cost Unit ---
    per_cost_unit = defaultdict(float)
    item_count_per_cost_unit = defaultdict(int)
    for row in all_rows:
        unit = row.get("cost_unit", "UNKNOWN")
        cost = row.get("cost", 0.0)
        per_cost_unit[unit] += cost
        item_count_per_cost_unit[unit] += 1

    print("\n=== BREAKDOWN BY COST UNIT ===")
    # Sort by cost unit value if possible, otherwise treat as string
    def sort_key(unit_key):
        try:
            return float(unit_key)
        except (ValueError, TypeError):
            return float('inf') # Put non-numeric keys last

    sorted_units = sorted(per_cost_unit.keys(), key=sort_key)

    for unit in sorted_units:
        total_cost_for_unit = per_cost_unit[unit]
        count = item_count_per_cost_unit[unit]
        formatted_cost = locale.format_string("%.2f", total_cost_for_unit, grouping=True)
        print(f"\nCost Unit: {unit} ({count} items)")
        print(f"  Total Cost: CHF {formatted_cost}")

if __name__ == "__main__":
    main()
