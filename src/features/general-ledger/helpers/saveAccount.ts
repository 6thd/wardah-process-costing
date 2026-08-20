import type {
  CreateGLAccountInput,
  GLAccount,
  UpdateGLAccountInput,
} from '@/lib/supabase';

type AccountType = CreateGLAccountInput['account_type'];
type ModalType = 'add' | 'edit';
type Translate = (key: string, options?: Record<string, unknown>) => string;

interface SaveAccountDependencies {
  getEffectiveTenantId: () => Promise<string | null>;
  checkAccountCodeExists: (code: string, excludeId?: string) => Promise<boolean>;
  createGLAccount: (input: CreateGLAccountInput) => Promise<{ success: boolean; error?: string }>;
  updateGLAccount: (input: UpdateGLAccountInput) => Promise<{ success: boolean; error?: string }>;
}

interface SaveAccountInput {
  formData: Partial<GLAccount>;
  modalType: ModalType;
  selectedAccount: GLAccount | null;
  t: Translate;
}

export type SaveAccountOutcome =
  | { status: 'rejected'; message: string }
  | { status: 'saved'; message: string };

function requiredFieldsAreMissing(formData: Partial<GLAccount>) {
  return !formData.code || !formData.name || !formData.category;
}

function shouldCheckDuplicateCode(
  modalType: ModalType,
  selectedAccount: GLAccount | null,
  code: string,
) {
  if (modalType === 'add') return true;
  return Boolean(selectedAccount && code !== selectedAccount.code);
}

function buildCreateInput(formData: Partial<GLAccount>, accountType: AccountType): CreateGLAccountInput {
  return {
    code: formData.code as string,
    name: formData.name as string,
    name_ar: formData.name_ar,
    name_en: formData.name_en,
    account_type: accountType,
    parent_id: formData.parent_id || null,
    is_active: formData.is_active !== false,
  };
}

function buildUpdateInput(
  formData: Partial<GLAccount>,
  selectedAccount: GLAccount,
  accountType: AccountType,
): UpdateGLAccountInput {
  return {
    id: selectedAccount.id,
    code: formData.code,
    name: formData.name,
    name_ar: formData.name_ar,
    name_en: formData.name_en,
    account_type: accountType,
    parent_id: formData.parent_id || null,
    is_active: formData.is_active,
  };
}

async function persistAccount(
  input: SaveAccountInput,
  accountType: AccountType,
  dependencies: SaveAccountDependencies,
) {
  if (input.modalType === 'edit' && input.selectedAccount) {
    const result = await dependencies.updateGLAccount(
      buildUpdateInput(input.formData, input.selectedAccount, accountType),
    );
    if (!result.success) throw new Error(result.error || 'Update failed');
    return input.t('gl.updatedSuccess');
  }

  const result = await dependencies.createGLAccount(buildCreateInput(input.formData, accountType));
  if (!result.success) throw new Error(result.error || 'Create failed');
  return input.t('gl.createdSuccess');
}

export async function saveGeneralLedgerAccount(
  input: SaveAccountInput,
  dependencies: SaveAccountDependencies,
): Promise<SaveAccountOutcome> {
  const orgId = await dependencies.getEffectiveTenantId();
  if (!orgId) throw new Error(input.t('gl.orgIdNotFound'));

  if (requiredFieldsAreMissing(input.formData)) {
    return { status: 'rejected', message: input.t('gl.requiredFields') };
  }

  const code = input.formData.code as string;
  if (shouldCheckDuplicateCode(input.modalType, input.selectedAccount, code)) {
    const codeExists = await dependencies.checkAccountCodeExists(code, orgId);
    if (codeExists) {
      return {
        status: 'rejected',
        message: input.t('gl.duplicateCode', { code }),
      };
    }
  }

  const accountType = input.formData.category as AccountType;
  const message = await persistAccount(input, accountType, dependencies);
  return { status: 'saved', message };
}
