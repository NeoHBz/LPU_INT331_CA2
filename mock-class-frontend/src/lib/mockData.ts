
export interface User {
  username: string;
  fullName: string;
  email: string;
  avatar: string; // Initial based
  status: 'online' | 'away' | 'offline';
}

const names = [
  "Alice Smith", "Bob Johnson", "Charlie Brown", "David Wilson", 
  "Eva Miller", "Frank Davis", "Grace Taylor", "Henry Anderson", 
  "Ivy Thomas", "Jack White", "Kelly Martin", "Liam Harris"
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

// Credentials to be used for the main automation user (choosing the first one)
export const AUTOMATION_USER = {
    username: MOCK_USERS[0].username,
    password: "password123", // Simplified mock password for all
    fullName: MOCK_USERS[0].fullName
};
