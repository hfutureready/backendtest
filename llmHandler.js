import Together from "together-ai";
import dotenv from "dotenv";
dotenv.config();

const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });

export async function sendToLLM(messageslist) {
  
  try {
    const response = await together.chat.completions.create({
      messages: messageslist,
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
    });

    let rawOutput = response.choices[0].message.content;

    // ✅ Remove empty lines from LLM response
    const cleanedOutput = rawOutput
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join("\n");

    return cleanedOutput;
  } catch (err) {
    console.error("❌ LLM Error:", err.message);
    throw err;
  }
}
