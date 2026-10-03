"""Validate actual execution output, not quoted workflow source."""
from pathlib import Path
import re
import sys

MARKERS=(
 'QUARANTINE_COLUMN_GRANT_CONTROLS_PASS controls=9',
 'QC_MATERIAL_SERVER_PROBES_PASS return_reasons=3 old_cycle_completion=1',
 'QC_MATERIAL_HTTP_CONTROLS_PASS refusals=14 positive=2',
 'QC_MATERIAL_JOINT_RACES_PASS cases=17 blocked=17 oracle_mutants=8',
 'QC_MATERIAL_BROWSER_RECEIPT_REPLAY_DURING_HOLD_PASS',
 'QC_MATERIAL_BROWSER_STALE_FORM_NEW_EVENT_REFUSED_PASS',
 'QC_MATERIAL_BROWSER_FINAL_INSPECTION_LOST_RESPONSE_REPLAY_PASS',
 'QC_MATERIAL_BROWSER_RETURN_NEW_CONSUMPTION_PASS',
 'QC_MATERIAL_BROWSER_NEW_CYCLE_REVOKED_GRANT_NO_EFFECTS_PASS',
 'QC_MATERIAL_POST_BROWSER_QUARANTINE_PASS',
 'QC_MATERIAL_NATIVE_199_PASS chain=10 readback=22 identity=simulated release_ready=false')
CATALOG='QC_MATERIAL_199_CATALOG_PASS functions=22 controls=6 role_template=M199'
BROWSER=r'QC_MATERIAL_BROWSER_199_PASS proofs=5 profiles=4 database=wardah_issue_parent_198_canonical_qc199_browser_[0-9]+ identity=simulated'

def verify(output):
 lines=output.splitlines()
 for marker in MARKERS:
  if lines.count(marker)!=1:
   raise ValueError('MISSING_OR_DUPLICATE_MARKER: '+marker)
 if lines.count(CATALOG)!=2:
  raise ValueError('WRONG_CATALOG_COUNT')
 races=[line for line in lines if re.fullmatch(r'QC_MATERIAL_RACE_PASS case=[a-z_]+ blocked=true',line)]
 if len(races)!=17 or len(set(races))!=17:
  raise ValueError('WRONG_RACE_COUNT')
 if sum(bool(re.fullmatch(BROWSER,line)) for line in lines)!=1:
  raise ValueError('WRONG_BROWSER_IDENTITY')

if __name__=='__main__':
 verify(Path(sys.argv[1]).read_text())
 print('QC_MATERIAL_WORKFLOW_MARKERS_PASS')
