import {RenderMode, type ServerRoute} from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {path: '', renderMode: RenderMode.Prerender},
  {path: 'about', renderMode: RenderMode.Prerender},
  {path: 'user/:id', renderMode: RenderMode.Server},
  {path: 'client', renderMode: RenderMode.Client},
  {path: 'old', renderMode: RenderMode.Server, status: 301},
  {path: '**', renderMode: RenderMode.Server, status: 404},
];
