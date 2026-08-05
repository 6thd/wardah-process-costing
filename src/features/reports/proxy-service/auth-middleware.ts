import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './types';
import { supabase } from '@/lib/supabase';

// ميدلوير المصادقة — يتحقق من التوكن كجلسة Supabase حقيقية، لا من شكله فقط
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  next();
};
