#!/bin/bash

# This script will log you in to Supabase and deploy the translate-text function.

# 1. Login to Supabase
#    - You will be prompted to paste your access token.
supabase login

# 2. Link your project
#    - You will be prompted to enter your project ID.
supabase link

# 3. Deploy the function
supabase functions deploy translate-text
