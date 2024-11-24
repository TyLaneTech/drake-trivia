# Drake Trivia

## Trivia Category
**General Knowledge**

## Site URL
[draketrivia.com](http://draketrivia.com)

## Teams
- **Klayton, Lexi**
- **Shorty & Brad’s No-Neck**
- **K-Swag & Chester**
- **The Claw (Kyler) & Delanie**
- **Brad & Julie**

## Project Requirements
- **Score tracking dashboard**: Real-time score updates via web-sockets
- **Dynamic question screen**: Questions are populated in real-time & update without refreshing (sockets?)
- **Azure Storage Account Tables**: Act as databases
- **Team sign in**
- **Admin sign in**

## Scoring
- **Correct answers**: 5 points
- **First to answer**: Additional 3 points
- **Time spent answering**: Tracked and used to break ties
- **Double elimination**
- **Metrics**: Can be tracked to give “awards” to teams for things like “fastest-answers”, “most-accurate-answers”, etc.

## General Flow
1. **Team Sign in**: One team per device
2. **Admin Starts game**
3. **Teams compete**: Tournament style
4. **Inactive teams**: Redirected to the bracket screen where scores are updated live

## Project Structure
```plaintext
📁 Drake-Trivia/
├── 📜 app.py
├── 📄 README.md
├── 📁 static/
└───┬── 📁 images/
    └────── 🖼️ d-logo.png
    ├── 📁 js/ 
    └───┬── 📜 admin.js
        ├── 📜 global.js
        ├── 📜 login.js
        ├── 📜 questions.js
        └── 📜 scores.js
    ├── 📁 styles/
    └───┬── 🎨 admin.css
        ├── 🎨 global.css
        ├── 🎨 login.css
        ├── 🎨 questions.css
        └── 🎨 scores.css
├── 📁 templates/
└───┬── 🌐 admin.html
    ├── 🌐 login.html
    ├── 🌐 questions.html
    └── 🌐 scores.html
```
