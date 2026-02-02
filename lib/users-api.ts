// API service for fetching users from database

// const BASE_URL = 'https://server.totus.club';
const BASE_URL = 'https://server.totus.club';

export interface User {
  id: number;
  loyaltyId: string;
  name: string | null;
  fName: string | null;
  lName: string | null;
  email: string | null;
  phone: string | null;
  online: boolean;
  hasVoipToken: boolean;
  hasSocket: boolean;
}

// Get all users from database
export async function getAllUsers(): Promise<User[]> {
  try {
    const response = await fetch(`${BASE_URL}/api/users`);
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.status}`);
    }
    const data = await response.json();
    return data.users || [];
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
}

// Get user by loyalty_id
export async function getUserByLoyaltyId(loyaltyId: string): Promise<User | null> {
  try {
    const response = await fetch(`${BASE_URL}/api/users/${loyaltyId}`);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch user: ${response.status}`);
    }
    const data = await response.json();
    return data.user || null;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw error;
  }
}

// Format user display name
export function getUserDisplayName(user: User): string {
  if (user.name) {
    return user.name;
  }
  if (user.fName || user.lName) {
    return [user.fName, user.lName].filter(Boolean).join(' ');
  }
  if (user.email) {
    return user.email;
  }
  if (user.phone) {
    return user.phone;
  }
  return `User ${user.loyaltyId}`;
}

