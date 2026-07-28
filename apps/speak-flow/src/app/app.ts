import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

@Component({
  imports: [CommonModule, FormsModule, RouterModule],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  draft = '';
  isComplete = false;
  messages = [
    { role: 'assistant', text: 'Welcome. Imagine we have just met at a professional event. How would you introduce yourself?' },
  ];

  sendMessage() {
    const text = this.draft.trim();
    if (!text || this.isComplete) return;

    this.messages = [
      ...this.messages,
      { role: 'user', text },
      { role: 'assistant', text: 'That is a strong start. What would you like the other person to remember about you?' },
    ];
    this.draft = '';
    if (this.messages.length >= 5) this.isComplete = true;
  }
}
