# Drake Trivia

Drake Trivia is an interactive trivia application hosted on an Azure-based Flask server. This app was built for the first annual Drake family trivia tournament. The app features a dynamic, real-time gameplay experience using [Web PubSub for Socket.IO](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/socketio-quickstart#create-a-web-pubsub-for-socketio-resource) for live score updates and question delivery. Teams can sign in via a sleek interface, compete in double-elimination brackets, and track their progress on a live-scoring dashboard. Admins have dedicated tools to manage games, while Azure Storage Account Tables ensure efficient and scalable data management. With advanced metrics for rewarding team performance and a user-friendly design, Drake Trivia combines technology and fun for an engaging trivia experience.

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
- **Score tracking dashboard**: Real-time score updates via [Web PubSub for Socket.IO](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/socketio-quickstart#create-a-web-pubsub-for-socketio-resource)
- **Dynamic question screen**: Questions are populated in real-time & update without refreshing ([Web PubSub for Socket.IO](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/socketio-quickstart#create-a-web-pubsub-for-socketio-resource))
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
