// promptManager.js

function generateMedicalSummaryPrompt(extractedText, preferredLanguage, age, pastHealthData) {
    return `
You are a helpful AI assistant trained to analyze raw lab report text.

Your job is to extract medical findings and summarize them in simple terms that a non-medical person can understand. The user may provide a preferred language for the summary. If no language is provided, default to **English**.

the patient is ${age} years old and has the following health data: ${pastHealthData}.

Instructions:

1. **Ignore all personal or non-medical information**, such as names, dates, and lab details.
2. Identify all **lab test results** with values and reference ranges.
3. Focus on **abnormal or concerning values** only. For each:
   - State the **test name**
   - Show the **measured value**
   - Indicate if it's **higher or lower than normal**
   - Give a **layman explanation** of what that could mean
4. Provide a **one-line summary** of the main findings in **[LANGUAGE_HERE or default to English]**.
5. For any **potentially harmful** results, suggest appropriate **next steps** (e.g., consult a doctor, follow up, dietary/lifestyle change).
6. Avoid suggesting next steps unless truly needed, and avoid technical medical jargon.
7. Give the summary in a preferred language, or default to English if none is specified. in markdown format.

Do **not** include:
- Names or demographic info
- Lab logos or formatting
- Risk labels like "Dangerous" or "Not Dangerous"

Output language: **[${preferredLanguage} — or English if not specified]**

Here is the raw lab report text:

${extractedText}

    `;
  }

function generatemedicinesummary(extractedText, preferredLanguage,age, pastHealthData) {
    return `

the patient is ${age} years old.
1. **Text Extraction and Understanding**:
   - Input text: '${extractedText}'
   - Extract key details (drug name, composition, purpose, warnings). If unclear, make reasonable assumptions and note them.

2. **Language Preference**:
   - Respond in ${preferredLanguage}, ensuring medical accuracy and clarity.

3. **Past Health Data Integration**:
   - User's health data: '${pastHealthData}'
   - If health data is empty or vague, assume general safety precautions and note the need for more details.

4. **Drug Analysis**:
   - Identify the drug's active ingredients and pharmacological effects.
   - Explain how the drug may interact with the user's health conditions, including benefits, side effects, or risks (e.g., 'This may help with pain but could cause dizziness given your hypertension').
   - Flag contraindications or interactions with current medications, if any.

5. **Ayurvedic Alternative Suggestion**:
   - Suggest an Ayurvedic medicine or practice for the condition treated by the drug, if applicable (e.g., 'For pain, consider Boswellia serrata'). Provide its use and benefits.
   - If no Ayurvedic alternative exists, recommend supportive practices (e.g., diet or yoga).

6. **Output Format**:
   - Structure the response as:
     - **Medicine Details**: Drug name, composition, purpose.
     - **Analysis**: Effects based on health data, risks, benefits.
     - **Ayurvedic Suggestion**: Alternative medicine or practice.
     - **Recommendation**: Next steps (e.g., 'Consult a doctor').
   - Keep it concise, safe, and encourage medical consultation.

Provide the response in ${preferredLanguage}, ensuring all advice is cautious and professional.
    `;
  }
  
  module.exports = { generateMedicalSummaryPrompt , generatemedicinesummary };
  
