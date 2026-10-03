import type { Mail, LinkedAccount } from './types';
const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
export const demoAccounts: LinkedAccount[] = [
  { id: 'demo-personal', email: 'alex.personal@gmail.com', settings: { notifications: true, importantOnly: true } },
  { id: 'demo-work', email: 'alex.work@gmail.com', settings: { notifications: true, importantOnly: false } },
];
export const demoMails: Mail[] = [
  { id: 'demo-1', accountId: 'demo-work', accountEmail: 'alex.work@gmail.com', sender: 'Sofia Chen <sofia@studio.example>', subject: 'A final look at the launch', summary: 'Sofia shared the updated launch designs. She needs your approval by 3 PM today so the team can hand them off to engineering.', category: 'work', priority: 'high', action: 'Review the launch designs and send approval by 3 PM.', receivedAt: ago(12), read: false, archived: false },
  { id: 'demo-2', accountId: 'demo-personal', accountEmail: 'alex.personal@gmail.com', sender: 'Northbank <hello@northbank.example>', subject: 'Your October statement is ready', summary: 'Your monthly account statement is available. The email is a routine update and does not request a payment.', category: 'finance', priority: 'normal', action: '', receivedAt: ago(38), read: false, archived: false },
  { id: 'demo-3', accountId: 'demo-work', accountEmail: 'alex.work@gmail.com', sender: 'Daniel Park <daniel@studio.example>', subject: 'Quick decision on Friday’s workshop', summary: 'Daniel is finalizing the workshop guest list. Confirm whether you can join Friday at 10 AM before he books the room today.', category: 'work', priority: 'high', action: 'Confirm your attendance for Friday’s workshop today.', receivedAt: ago(55), read: false, archived: false },
  { id: 'demo-4', accountId: 'demo-personal', accountEmail: 'alex.personal@gmail.com', sender: 'Maya <maya@friends.example>', subject: 'Same table, this Saturday?', summary: 'Maya is planning lunch at your usual place on Saturday. She would love to know if you can make it.', category: 'personal', priority: 'normal', action: 'Let Maya know if Saturday lunch works.', receivedAt: ago(100), read: true, archived: false },
  { id: 'demo-5', accountId: 'demo-personal', accountEmail: 'alex.personal@gmail.com', sender: 'The Design Edit <weekly@design.example>', subject: 'Small details. Better products.', summary: 'This week’s newsletter explores thoughtful onboarding, accessible color palettes, and three new design tools.', category: 'updates', priority: 'low', action: '', receivedAt: ago(150), read: true, archived: false },
];
