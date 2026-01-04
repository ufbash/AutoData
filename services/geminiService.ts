import { GoogleGenAI, Type } from "@google/genai";
import { StandardizedCarData, MarketForecast } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const standardizeVehicleString = async (input: string): Promise<StandardizedCarData> => {
  if (!apiKey) {
    throw new Error("API Key is missing. Please set the API_KEY environment variable.");
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Extract vehicle and sales information from this text: "${input}". 
      
      Rules:
      1. If a year is not present, use "Unknown". 
      2. If sub-model is not present, use "Base".
      3. Extract price as a number (ignore currency symbols like NGN, $).
      4. Detect currency code (default to NGN if ambiguous but looks like Naira).
      5. Extract Dealer/Seller name if present (e.g., "Sold by...", "Dealer: ...").
      6. Extract Date Sold if present (format YYYY-MM-DD).
      
      Ensure Make and Model are proper casing.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            make: { type: Type.STRING },
            model: { type: Type.STRING },
            subModel: { type: Type.STRING },
            year: { type: Type.STRING },
            price: { type: Type.NUMBER },
            currency: { type: Type.STRING, enum: ['NGN', 'USD', 'EUR', 'GBP'] },
            dealer: { type: Type.STRING },
            dateSold: { type: Type.STRING }
          },
          required: ["make", "model", "subModel", "year"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return JSON.parse(text) as StandardizedCarData;
  } catch (error) {
    console.error("Gemini standardization failed:", error);
    return {
      make: "Unknown",
      model: input,
      subModel: "Unknown",
      year: "Unknown"
    };
  }
};

export const generateMarketForecast = async (salesSummary: any): Promise<MarketForecast> => {
  if (!apiKey) throw new Error("API Key is missing.");

  const prompt = `
    Analyze the following car sales data summary to forecast demand for the next quarter.
    Data Summary: ${JSON.stringify(salesSummary)}
    
    Identify trends in:
    1. Which models are selling the fastest (days on market).
    2. Which models have the highest volume.
    
    Provide a concise prediction for what cars I should acquire to sell next.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            prediction: { type: Type.STRING, description: "A 2-3 sentence strategic advice on what to buy." },
            recommendedModels: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "List of top 3 specific car models to acquire."
            },
            marketSentiment: { 
              type: Type.STRING, 
              enum: ['bullish', 'bearish', 'neutral'],
              description: "Overall market speed/demand sentiment."
            }
          },
          required: ["prediction", "recommendedModels", "marketSentiment"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    return JSON.parse(text) as MarketForecast;
  } catch (error) {
    console.error("Forecast generation failed", error);
    throw error;
  }
};
