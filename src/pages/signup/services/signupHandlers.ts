import { getSupabase } from '@/lib/supabase';
import { getOrganizationByCode, addUserToOrganization } from '@/services/organization-service';
import { acceptInvitation } from '@/services/org-admin-service';
import type { InvitationData, SignUpFormData } from '../types';

interface SignUpResult {
  success: boolean;
  message: string;
  error?: string;
}

export async function handleInviteSignUp(
  formData: SignUpFormData,
  invitation: InvitationData,
  inviteToken: string
): Promise<SignUpResult> {
  const supabase = getSupabase();

  if (formData.email.trim().toLowerCase() !== invitation.email.toLowerCase()) {
    return {
      success: false,
      message: '',
      error: `البريد الإلكتروني يجب أن يكون ${invitation.email}`
    };
  }

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: formData.email.trim(),
    password: formData.password,
    options: {
      data: {
        full_name: formData.fullName.trim(),
      },
    },
  });

  if (signUpError) {
    throw signUpError;
  }

  if (!authData.user) {
    return {
      success: false,
      message: '',
      error: 'فشل إنشاء الحساب'
    };
  }

  const result = await acceptInvitation(inviteToken, authData.user.id);
  
  if (!result.success) {
    return {
      success: false,
      message: '',
      error: result.error || 'فشل قبول الدعوة'
    };
  }

  return {
    success: true,
    message: `✅ تم التسجيل بنجاح! مرحباً بك في ${invitation.org_name}`
  };
}

export async function handleJoinSignUp(
  formData: SignUpFormData
): Promise<SignUpResult> {
  const supabase = getSupabase();
  const org = await getOrganizationByCode(formData.orgCode);
  
  if (!org) {
    return {
      success: false,
      message: '',
      error: 'رمز المنظمة غير صحيح أو المنظمة غير نشطة'
    };
  }

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: formData.email.trim(),
    password: formData.password,
    options: {
      data: {
        full_name: formData.fullName.trim(),
      },
    },
  });

  if (signUpError) {
    throw signUpError;
  }

  if (!authData.user) {
    return {
      success: false,
      message: '',
      error: 'فشل إنشاء الحساب'
    };
  }

  const result = await addUserToOrganization({
    userId: authData.user.id,
    orgId: org.id,
    role: 'user',
  });

  if (!result.success) {
    return {
      success: false,
      message: '',
      error: result.error || 'فشل إضافة المستخدم للمنظمة'
    };
  }

  return {
    success: true,
    message: '✅ تم التسجيل بنجاح! يرجى تأكيد بريدك الإلكتروني للمتابعة'
  };
}

export async function handleCreateOrgSignUp(
  formData: SignUpFormData
): Promise<SignUpResult> {
  const supabase = getSupabase();

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: formData.email.trim(),
    password: formData.password,
    options: {
      data: {
        full_name: formData.fullName.trim(),
      },
    },
  });

  if (signUpError) {
    throw signUpError;
  }

  if (!authData.user) {
    return {
      success: false,
      message: '',
      error: 'فشل إنشاء الحساب'
    };
  }

  const { data: orgData, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name: formData.newOrgName.trim(),
      name_ar: formData.newOrgNameAr.trim() || formData.newOrgName.trim(),
      code: formData.newOrgCode.trim().toUpperCase(),
      is_active: true,
    })
    .select()
    .single();

  if (orgError) {
    throw orgError;
  }

  const { error: userOrgError } = await supabase
    .from('user_organizations')
    .insert({
      user_id: authData.user.id,
      org_id: orgData.id,
      role: 'admin',
      is_active: true,
    });

  if (userOrgError) {
    throw userOrgError;
  }

  return {
    success: true,
    message: '✅ تم إنشاء المنظمة والحساب بنجاح! يرجى تأكيد بريدك الإلكتروني'
  };
}

export function getSignUpErrorMessage(error: any): string {
  let errorMessage = 'فشل التسجيل. يرجى المحاولة مرة أخرى.';

  if (error.message?.includes('already registered')) {
    errorMessage = 'البريد الإلكتروني مسجل بالفعل';
  } else if (error.message?.includes('duplicate key')) {
    errorMessage = 'رمز المنظمة مستخدم بالفعل';
  } else if (error.message) {
    errorMessage = error.message;
  }

  return errorMessage;
}

