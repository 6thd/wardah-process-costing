"""Durable marker controls, using real output when supplied by the runner."""
from pathlib import Path
import sys
from check_markers import CATALOG, MARKERS, verify

def output_lines():
 if len(sys.argv)==2:
  return Path(sys.argv[1]).read_text()
 # Dependency-free verifier control used before installation in CI.
 lines=[*MARKERS,CATALOG,CATALOG]
 lines.extend(f'QC_MATERIAL_RACE_PASS case=case_{chr(97+i)} blocked=true' for i in range(17))
 lines.append('QC_MATERIAL_BROWSER_199_PASS proofs=5 profiles=4 database=wardah_issue_parent_198_canonical_qc199_browser_123 identity=simulated')
 return '\n'.join(lines)

def mutants(output):
 race=next(line for line in output.splitlines() if line.startswith('QC_MATERIAL_RACE_PASS case='))
 browser=next(line for line in output.splitlines() if line.startswith('QC_MATERIAL_BROWSER_199_PASS'))
 variants=[output.replace(marker,'',1) for marker in MARKERS]
 variants.extend([
  output.replace(CATALOG,'',1),output+'\n'+CATALOG,
  output.replace(race,'',1),output+'\n'+race,
  output.replace(browser,browser.replace('identity=simulated','identity=hosted')),
  output.replace(browser,browser.replace('wardah_issue_parent_198_canonical_qc199_browser_','production_')),
  output.replace('blocked=17','blocked=16'),
  '\n'.join('echo '+line for line in output.splitlines()),
 ])
 return variants

def main():
 output=output_lines()
 verify(output)
 variants=mutants(output)
 for mutant in variants:
  try:
   verify(mutant)
  except ValueError:
   pass
  else:
   raise AssertionError('WORKFLOW_MARKER_FALSE_GREEN')
 print(f'QC_MATERIAL_MARKER_CONTROLS_PASS positive=1 refused={len(variants)}')

if __name__=='__main__':
 main()
