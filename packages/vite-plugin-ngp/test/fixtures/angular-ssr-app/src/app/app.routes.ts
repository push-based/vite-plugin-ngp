import {Component, input} from '@angular/core';
import type {Routes} from '@angular/router';

@Component({selector: 'app-home', template: '<p id="page">home</p>'})
class Home {}

@Component({selector: 'app-about', template: '<p id="page">about</p>'})
class About {}

@Component({selector: 'app-user', template: '<p id="page">user {{ id() }}</p>'})
class User {
  readonly id = input('');
}

@Component({selector: 'app-not-found', template: '<p id="page">not found</p>'})
class NotFound {}

export const routes: Routes = [
  {path: '', component: Home},
  {path: 'about', component: About},
  {path: 'user/:id', component: User},
  {path: 'client', component: Home},
  {path: 'old', redirectTo: 'about'},
  {path: '**', component: NotFound},
];
