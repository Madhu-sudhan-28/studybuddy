# StudyBuddy

StudyBuddy is focused on education: learners can ask about a subject, enter a short topic or question, or provide notes to build lessons, quizzes, and review plans. Detailed notes guide course-specific explanations; short prompts are answered with standard educational knowledge. Text files and pasted notes are handled in the browser. Without a Groq API key, images use basic English OCR. With Groq configured, the app can identify study-worthy facts, labels, steps, and diagram relationships while leaving out visual clutter.

## Learning tools and progress

The Learning room shows whether study progress is saving and offers a retry after a save failure. Lessons and quiz explanations may show a related verbatim passage matched from the original notes; it is a checking aid, not a guarantee that every explanation claim is supported. Readiness is an estimate based on lesson and quiz checks, with untested topics lowering the estimate, and it suggests topics for review. Lessons can be read aloud in English using the browser's speech synthesis. The print view includes the plan outline and open lesson and can be saved as a PDF using the browser print dialog. Missed quiz answers appear directly below results with the learner's answer, the correct answer, and an option to request another explanation; there is no separate Revision room or follow-up quiz.

When creating a plan, choose how many days you have (up to 30) and enter the hours you can study on each day. StudyBuddy distributes topics across the days based on available time. If you choose more days than there are topics, the remaining days become spaced-review sessions instead of being left empty. Uploading a new image resets the daily study-hour fields to one hour per day.

With `GROQ_API_KEY` configured, the Learning room uses Groq's API and `qwen/qwen3.8-27b` for lessons, quizzes, explanations, and image analysis. Module names and section headings are retained as context. Hyphen, symbol, and numbered list items become focused lessons; comma-separated subtopics and clearly capitalized and-separated subtopics inside list items become separate pages. Short standalone lines beneath headings are also treated as individual topics, supporting pasted outlines without bullets. Longer entries are divided into sentence-aligned parts of up to about 900 characters. Study plans can contain up to 500 focused lessons, so larger syllabi are not silently reduced to a handful of module-level lessons. Each topic becomes its own lesson page, like one question per quiz page. Only the selected topic is sent to Groq, and its page is generated when opened; the next topic is not prefetched. Lessons use beginner-friendly wording, detailed bullet points, step-by-step reasoning, and one worked example, aiming for about 200 words, with each bullet under 25 words, within a 1,400-token response budget. A flowchart or concept map is added only when it helps explain a process or connected ideas. The detailed lesson is always attempted first. Only if Groq hits the token limit does StudyBuddy automatically retry, up to twice, with progressively shorter lessons. If the shorter response is also cut off, it shows only complete sentences and offers another retry. Follow-up answers provide a focused, detailed explanation and example when useful. Learners can ask for a specific part of the current topic to be explained further; that request sends only the topic's notes and the learner's question. After the lessons, StudyBuddy creates one lesson-based multiple-choice question for every topic, plus one applied problem with a worked solution. Quiz questions are generated one at a time only after the learner advances, using a small per-question token budget instead of requesting the full quiz at once. MCQs are instructed to test their assigned lesson topics with plausible distractors; repeated question stems and repeated answer choices are rejected, and the correct option position is shuffled. Learners can change a selected option until they press **Check answer**. The applied problem uses a calculation when the material supports one; otherwise it tests a practical application. Missed quiz answers are shown directly below results with the learner's answer, the correct answer, and an option to request another explanation. There is no separate Revision room or follow-up quiz. Groq model availability and account limits apply. AI output can still be wrong; compare important details with your source material and trusted references. Study progress, extracted text, and private image records are stored in the user's account database; original images are held in a private Supabase Storage bucket for 30 days and appear in that user's Study history. A missing key or API error is shown in the Learning room; the app does not silently substitute a planner or raw notes for generated learning content.

## Run locally

StudyBuddy uses your Supabase PostgreSQL database for accounts, sessions, study plans, and history. Python 3.9 or later is required. Install the PostgreSQL driver using `python -m pip install -r requirements.txt`. Optional AI image understanding and lesson generation use Groq's Chat Completions API through the Python backend. Image uploads still work without a Groq key using browser-based OCR, but OCR reads visible English text only; it cannot interpret diagrams or filter irrelevant text.

1. Install the Python dependency with `python -m pip install -r requirements.txt`. Copy `.env.example` to `.env` and set `DATABASE_URL` to the PostgreSQL URI from your Supabase project's **Session pooler** connection settings. To enable AI lessons, get an API key from your [Groq account](https://console.groq.com/keys) and set `GROQ_API_KEY` too:

   ```text
   GROQ_API_KEY=your-api-key
   DATABASE_URL=your-supabase-postgresql-uri
   ```

2. The server requires `DATABASE_URL` and creates its tables in Supabase automatically on startup. Keep the URI private. On Windows, double-click `start-studybuddy.bat`. It starts the server in the background without leaving a terminal window open and opens StudyBuddy in your browser. Users can register with email and password without SMTP, or sign in with Google. Email/password registration requires at least 8 characters, including uppercase and lowercase letters, a number, and a symbol. Accounts are created immediately without email verification; password recovery by email is not available. To run it in a terminal for troubleshooting, use `python server.py` from this folder.
3. The background server stays available while you use StudyBuddy. To stop it, close the `pythonw.exe` process running `server.py` in Task Manager. If you add or change the key after starting, stop and restart the server.

### Share study history between local and deployed sites

Study history is stored by the server in the Supabase database selected by `DATABASE_URL`. To see plans created on either localhost or the deployed site in both places, configure both environments with the same Supabase `DATABASE_URL` and sign in with the same account. Set the URI in the local `.env` and in the deployed host's private environment variables, then restart the local server and redeploy after changing the deployed value. A different database or account has separate history.

StudyBuddy stores account credentials (as salted password hashes), login sessions, each user's current study plan, saved plans, and private image metadata in Supabase. Original images are stored in a private Supabase Storage bucket for 30 days; users can preview and download their own images from Study history. A daily Vercel cron job removes expired objects. Keep all Supabase credentials private and back up important data. Existing data from the old local SQLite file is not copied automatically. This local server is not reachable from other devices over the internet.

### Admin page

The admin dashboard is available at `/admin`. Configure `STUDYBUDDY_ADMIN_PASSWORD` with a private password of at least 8 characters, including uppercase and lowercase letters, a number, and a symbol. Also set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` in `.env` and in Vercel's private environment variables. The service-role key must never be exposed in browser code. The app creates the private `studybuddy-uploads` bucket on first image save; set `SUPABASE_STORAGE_BUCKET` only if you want another bucket name. The dashboard shows account and usage counts, lets admins preview/download/delete images, and lets admins disable, re-enable, or permanently delete accounts. Selecting a user's email opens all saved study history and its retained images; admins can preview and download those images. Disabling an account revokes its active sessions; deleting an account also removes its saved plans and images. The 30-day image retention is enforced by a daily scheduled cleanup.

To let users sign in from anywhere, deploy the Python server to a public host, use HTTPS, set `STUDYBUDDY_HOST=0.0.0.0`, and let the host provide `PORT`. Configure `DATABASE_URL`, `GROQ_API_KEY`, and the Google OAuth variables below as private server environment variables; never put secrets in browser code. Email/password registration does not require SMTP and does not verify ownership of the supplied email. Password recovery by email is not provided. StudyBuddy sends images and selected lesson excerpts to Groq for analysis and generation; review Groq's data and usage policies before uploading private material.

### Configure Google sign-in

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), keep the OAuth consent screen set to **External** and the publishing status at **Testing** while you try the app. Add your Google account under **Test users**. In the **Web application** OAuth client, set these **Authorized JavaScript origins**:

```text
http://127.0.0.1:8000
https://studybuddy-nine-rosy.vercel.app
```

Set these **Authorized redirect URIs**:

```text
http://127.0.0.1:8000/api/auth/google/callback
https://studybuddy-nine-rosy.vercel.app/api/auth/google/callback
```

Copy `.env.example` to `.env`, then set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the local `GOOGLE_REDIRECT_URI` there. For Vercel, add all three as server-side environment variables and set `GOOGLE_REDIRECT_URI` to `https://studybuddy-nine-rosy.vercel.app/api/auth/google/callback`. Redeploy after changing Vercel environment variables. Never put the client secret in frontend code, commit it, or share it. The callback validates Google's signed ID token, verified email, OAuth state, nonce, and PKCE challenge before creating a session. Google sign-in creates new accounts and continues to support existing Google accounts. It does not automatically link to an email/password account. Email/password registration and login are also available without SMTP.

Supported images include PNG, JPEG, WebP, and GIF. Other formats are converted to JPEG in the browser when the browser can decode them. Text uploads and pasted notes continue to work without a Groq API key.
