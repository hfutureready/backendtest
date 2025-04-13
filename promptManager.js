// promptManager.js

function generateMedicalSummaryPrompt(extractedText, preferredLanguage, age, pastHealthData) {
   return `
 
 You need consider on the patient's age (${age} years) and past health records (${pastHealthData}). Use ${preferredLanguage} for the summary, defaulting to English if none is specified.
 
 Instructions:
 1. Ignore non-medical details like names or dates.
 2. Identify lab test results, focusing only on abnormal values.
 3. For each abnormal result, include:
    - Test name and measured value.
    - Whether it's higher or lower than normal.
    - A brief, layman explanation of what it might mean.
 4. Provide a one-sentence summary of the main findings.
 5. Suggest next steps (e.g., see a doctor) only for concerning results, keeping it short.
 6. Avoid technical jargon or unnecessary details.
 
 Output in plain text, not markdown, in ${preferredLanguage} or English if not specified.
 
 Raw lab report text:
 ${extractedText}
   `;
 }
 
 function generateMedicineSummary(extractedText, preferredLanguage, age, pastHealthData) {
   return `
 
 
 Provide a concise summary based on the patient's age (${age} years) and past health records (${pastHealthData}) in ${preferredLanguage}, defaulting to English if none is specified.
 
 Instructions:
 1. Extract key details from the input text: '${extractedText}' (drug name, purpose, warnings).
 2. Explain the drug's effects, benefits, and risks, considering the patient's health data.
 3. Note any potential interactions or side effects briefly.
 4. Suggest one Ayurvedic alternative or supportive practice (e.g., diet or yoga) for the condition, if applicable.
 5. Keep the response short, in plain text, with these sections:
    - Medicine: Name, purpose.
    - Effects: Benefits, risks, or interactions.
    - Ayurvedic Option: Alternative or practice.
    - Next Steps: Brief advice (e.g., consult a doctor).
 6. Ensure all advice is cautious and encourages medical consultation.
 
 Respond in ${preferredLanguage} or English if not specified.
   `;
 }
 
 module.exports = { generateMedicalSummaryPrompt, generateMedicineSummary };
