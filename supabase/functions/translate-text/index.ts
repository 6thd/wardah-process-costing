import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'

const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY')
const GOOGLE_TRANSLATE_URL = `https://translation.googleapis.com/language/translate/v2`

serve(async (req) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { text, target } = await req.json()

    if (!text) {
      throw new Error('Missing "text" in request body.')
    }
    if (!target) {
      throw new Error('Missing "target" language in request body.')
    }
    if (!GOOGLE_API_KEY) {
      throw new Error('Google API key is not set in Supabase secrets.')
    }

    const response = await fetch(GOOGLE_TRANSLATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': GOOGLE_API_KEY,
      },
      body: JSON.stringify({
        q: text,
        target: target,
      }),
    })

    if (!response.ok) {
        const errorData = await response.json();
        console.error('Google Translate API error:', errorData);
        throw new Error(`Google Translate API request failed with status ${response.status}: ${errorData.error.message}`);
    }

    const result = await response.json()
    const translatedText = result.data.translations[0].translatedText

    return new Response(JSON.stringify({ translatedText }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
