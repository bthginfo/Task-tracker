export type Status = 'todo' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high';
export interface Topic { id: string; name: string; color: string; createdAt: string }
export interface Task {
  id: string; title: string; notes: string; status: Status; priority: Priority;
  topicId: string | null; parentId: string | null;
  dueDate: string | null; time: string | null; duration: number;
  calendarEnabled: boolean;
  calendarSyncStatus: 'off' | 'waiting' | 'pending' | 'synced' | 'error';
  calendarError: string | null; createdAt: string; updatedAt: string;
}
export type TaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'calendarSyncStatus' | 'calendarError'>>;
export interface CalendarInfo { configured: boolean; connected: boolean; email: string | null; calendarId: string; lastSyncedAt: string | null; error: string | null }
export interface AppState { tasks: Task[]; topics: Topic[]; calendar: CalendarInfo; voice: { enhanced: boolean }; auth: { protected: boolean } }
export interface CalendarOption { id: string; summary: string; primary?: boolean }
export interface VoiceResult { text: string; original: string; suggested: { title: string; dueDate: string | null; time: string | null; priority: Priority; topicId: string | null } }
export interface ImportRow { key:string; title:string; notes:string; dueDate:string|null; time:string|null; duration:number; status:Status; priority:Priority; topicName:string|null; duplicate:boolean; parentKey?:string|null }
