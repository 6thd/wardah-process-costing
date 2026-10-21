/** #229 release hold. A mistaken flag cannot enable these pages in production. */
export function isolatedMaterialIssueEnabled(): boolean {
  return !import.meta.env.PROD && import.meta.env.VITE_MATERIAL_ISSUE_ISOLATED === 'true'
}
