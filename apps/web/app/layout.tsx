import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Distributed Job Queue', description: 'Demo job queue dashboard' };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><main>{children}</main></body></html>; }
