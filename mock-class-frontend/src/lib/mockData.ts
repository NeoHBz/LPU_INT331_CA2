
export interface User {
  username: string;
  fullName: string;
  email: string;
  avatar: string; // Initial based
  status: 'online' | 'away' | 'offline';
}

const names = [
  "Amit Sharma", "Priya Verma", "Rohit Patel", "Sneha Gupta",
  "Vikram Singh", "Anjali Mehta", "Arjun Reddy", "Kiran Nair",
  "Riya Kapoor", "Sanjay Chauhan", "Meera Iyer", "Aditya Joshi"
];

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

export const generateMockUsers = (): User[] => {
  return names.map((name, index) => {
    const username = name.toLowerCase().replace(' ', '');
    return {
      username: username,
      fullName: name,
      email: `${username}@mockschool.edu`,
      avatar: getInitials(name),
      status: index % 3 === 0 ? 'online' : index % 3 === 1 ? 'away' : 'offline'
    };
  });
};

export const MOCK_USERS = generateMockUsers();

// Shared mock password for all users
export const MOCK_PASSWORD = "password123";

// Credentials to be used for the main automation user (choosing the first one)
export const AUTOMATION_USER = {
    username: MOCK_USERS[0].username,
    password: MOCK_PASSWORD,
    fullName: MOCK_USERS[0].fullName
};

// Convenience helper to locate a mock user by username (case-insensitive)
export const findMockUser = (username: string) =>
  MOCK_USERS.find((user) => user.username.toLowerCase() === username.trim().toLowerCase());
