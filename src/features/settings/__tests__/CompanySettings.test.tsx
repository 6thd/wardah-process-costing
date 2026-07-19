import { act, fireEvent, render, screen } from '@/test/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { CompanySettings } from '../CompanySettings';

const mocks = vi.hoisted(() => ({
  getOrganizationProfile: vi.fn(),
  updateOrganizationProfile: vi.fn(),
  upload