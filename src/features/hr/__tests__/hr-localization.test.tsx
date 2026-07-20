import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { useHrTranslation } from '../i18n';
import '../translations/pages';
import '../translations/reports';

function flatten(value: unknown, prefix = '', target: Record<string, string> = {})