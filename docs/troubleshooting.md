---
id: cost-troubleshooting
slug: /cost-troubleshooting
title: Troubleshooting
sidebar_label: Troubleshooting
---

| Issue | Likely cause | Solution |
|-------|--------------|----------|
| Red pills persist after Excel import | Kennwert cell left blank or non-numeric | Check *UnitCost* column, use dot decimal, re-import. |
| Reapply button does nothing | No Kennwerte changed | Edit at least one value or import Excel. |
| Confirm button disabled | Still red pills or Kafka disconnected | Fill missing values or wait for admin to restore Kafka. |
| Totals look way off | Quantity mismatch from QTO | Verify Net/Gross quantities in QTO first. |
| Sidebar shows extra groups | New eBKP codes appeared after re-upload | Enter Kennwerte for the new groups. |

---

### Logs
Backend logs are at `backend/logs/*.log` inside the Cost container. Attach them when contacting support.

---

Need further help? Email **support@fastbim5.eu**. 