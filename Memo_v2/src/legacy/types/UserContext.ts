import { UserGoogleToken, UserPlanType, UserRecord } from '../services/database/UserService';

export interface UserCapabilities {
  database: boolean;
  calendar: boolean;
  gmail: boolean;
}

export interface RequestUserContext {
  user: UserRecord;
  planType: UserPlanType;
  whatsappNumber: string;
  capabilities: UserCapabilities;
  googleTokens?: UserGoogleToken | null;
  googleConnected: boolean;
}

