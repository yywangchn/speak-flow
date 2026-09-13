import { Component, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-practice-welcome',
  imports: [CommonModule],
  templateUrl: './practice-welcome.html',
  styleUrl: './practice-welcome.scss',
  encapsulation: ViewEncapsulation.None,
})
export class PracticeWelcome {}
