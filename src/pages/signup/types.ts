export interface InvitationData {
  id: string;
  email: string;
  org_id: string;
  org_name?: string;
  status: string;
  expires_at: string;
}

export interface SignUpFormData {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  orgCode: string;
  newOrgName: string;
  newOrgNameAr: string;
  newOrgCode: string;
}


