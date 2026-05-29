/**
 * Course Type Definition
 */
export interface CourseResource {
  title: string;
  link: string;
  fileId?: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  handouts: CourseResource[];
  others: CourseResource[];
  courseDate?: string;
  videos: CourseResource[]; // Empty for visitors
  uploaderId: string;
  uploadTime: string;
  semester: string;
  permission: 'visitor' | 'member';
}
