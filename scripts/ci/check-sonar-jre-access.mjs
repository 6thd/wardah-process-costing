// Diagnose the same EU JRE endpoint used by the configured scanner.
// Print status only: never token, authorization header or response content.
import { pathToFileURL } from 'node:url'

const JRE_URL = 'https://api.sonarcloud.io/analysis/jres?os=linux&arch=x86_64'

export async function diagnoseAuthentication(token, fetchImpl = fetch) {
  try {
    const response = await fetchImpl('https://sonarcloud.io/api/authentication/validate', {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (response.status !== 200) return `SONAR_AUTH_HTTP_${response.status}`
    const data = await response.json()
    if (typeof data.valid !== 'boolean') return 'SONAR_AUTH_RESPONSE_UNEXPECTED'
    return `SONAR_AUTH_VALID_${data.valid}`
  } catch {
    return 'SONAR_AUTH_DIAGNOSTIC_UNAVAILABLE'
  }
}

export async function checkJreAccess(token, fetchImpl = fetch) {
  if (!token) throw new Error('SONAR_TOKEN_MISSING')
  let response
  try {
    response = await fetchImpl(JRE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('SONAR_JRE_ACCESS_NETWORK_ERROR')
  }
  // Do not parse or emit the body: it is unnecessary for this access check.
  if (response.status !== 200) {
    throw new Error(`SONAR_JRE_ACCESS_HTTP_${response.status}`)
  }
  return 'SONAR_JRE_ACCESS_HTTP_200'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(await checkJreAccess(process.env.SONAR_TOKEN))
  } catch (error) {
    console.error(`::error::${error.message}`)
    if (process.env.SONAR_TOKEN) {
      console.log(await diagnoseAuthentication(process.env.SONAR_TOKEN))
    }
    process.exitCode = 1
  }
}
