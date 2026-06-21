import { GoogleGenAI, Type } from "@google/genai";
import { StandardizedCarData, MarketForecast, CarSale } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const extractVehicleDataFromImages = async (
  image1Base64: string,
  image1MimeType: string,
  image2Base64: string,
  image2MimeType: string
): Promise<Partial<CarSale>> => {
  if (!apiKey) {
    throw new Error("API Key is missing. Please set VITE_GEMINI_API_KEY in your .env file.");
  }

  const modelName = "gemini-3.5-flash";
  console.log("Sending to Gemini:", modelName);

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Identify and extract car sales data from two images. 
              - **Sold Date:** Look at the VERY TOP of Image 1 (the Story/Highlight). It usually shows a date like '14 February'. Assume the year is 2026 unless the year is specifically shown. 
              - **List Date:** Look at the VERY BOTTOM of Image 2 (the Post). It shows when the post was made, e.g., '9 February'. Assume the year is 2026 unless the year is specifically shown. 
              - **Dealer:** Look at the profile name at the top left of either image (e.g., 'abujacar') or in the actual post, right before the cars details. It'll usually be in bold. 
              - **Specs:** Extract make, model, year, price, and mileage from the post description. 
              - **Trim:** Look closely at the post description for trim levels, performance variants, or packages (e.g., AMG, M-Sport, XSE, Limited, Longitude). If found, put this in the 'trim' field. If the description just says 'BMW 330i', the trim is '330i'.
              
              CRITICAL TAXONOMY RULE: Never combine Year, Make, Model, or Trim. 
              You MUST strictly follow these brand-specific taxonomy rules for Make, Model, and Trim: 
              1. **BMW:** 'Model' MUST be the Series or X-line (e.g., '3 Series', '5 Series', 'X5', 'X6'). 'Trim' is the specific badge and drivetrain (e.g., '330i xDrive', 'M50i', 'Competition'). Do NOT use '330i' as the Model. 
              2. **Mercedes-Benz:** 'Model' MUST be the Class or SUV line (e.g., 'C-Class', 'E-Class', 'G-Class', 'GLE', 'S-Class'). 'Trim' is the engine/badge (e.g., 'C 43 AMG', 'G 63', 'E 350'). Do NOT use 'C43' as the Model. 
              3. **Land Rover:** 'Model' is the core family (e.g., 'Range Rover', 'Range Rover Sport', 'Defender'). 'Trim' is the spec (e.g., 'Autobiography', 'HSE', 'V8 Carpathian'). 
              4. **General Rule:** 'Model' is the broad family. 'Trim' is the specific performance, package, or engine variant. If a trim is unknown, use 'Base', but never put a trim level into the Model field. 
              - 'Year' is ONLY the 4-digit number. 
              - 'Make' is the brand (e.g., 'Mercedes-Benz', 'Toyota'). 
              If a dealer posts '2024 Mercedes C43', you must return { year: '2024', make: 'Mercedes-Benz', model: 'C-Class', trim: 'C 43 AMG' }.

              Return as a clean JSON object with keys: { make, model, trim, year, price, originalCurrency, dateListed, dateSold, mileage, dealer }. 
              For 'originalCurrency', strictly use one of: 'NGN', 'USD', 'EUR', 'GBP'. Default to 'NGN' if ambiguous.
              Format dates as YYYY-MM-DD.
              If a field is missing, use null.
              Return ONLY the JSON object, no markdown formatting, no conversational text.`
            },
            {
              inlineData: {
                data: image1Base64,
                mimeType: image1MimeType
              }
            },
            {
              inlineData: {
                data: image2Base64,
                mimeType: image2MimeType
              }
            }
          ]
        }
      ]
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : text;
    
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Gemini vision extraction failed:", error);
    throw error;
  }
};

export const normalizeHistoricalData = async (salesBatch: CarSale[]): Promise<CarSale[]> => {
  if (!apiKey) {
    throw new Error("API Key is missing. Please set VITE_GEMINI_API_KEY in your .env file.");
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are a master automotive taxonomist. Fix this dirty car data. You MUST strictly follow these brand-specific taxonomy rules for Make, Model, and Trim: 
              
              1. **BMW:** 'Model' MUST be the Series or X-line (e.g., '3 Series', '5 Series', 'X5', 'X6'). 'Trim' is the specific badge and drivetrain (e.g., '330i xDrive', 'M50i', 'Competition'). Do NOT use '330i' as the Model. 
              2. **Mercedes-Benz:** 'Model' MUST be the Class or SUV line (e.g., 'C-Class', 'E-Class', 'G-Class', 'GLE', 'S-Class'). 'Trim' is the engine/badge (e.g., 'C 43 AMG', 'G 63', 'E 350'). Do NOT use 'C43' as the Model. 
              3. **Land Rover:** 'Model' is the core family (e.g., 'Range Rover', 'Range Rover Sport', 'Defender'). 'Trim' is the spec (e.g., 'Autobiography', 'HSE', 'V8 Carpathian'). 
              4. **General Rule:** 'Model' is the broad family. 'Trim' is the specific performance, package, or engine variant. If a trim is unknown, use 'Base', but never put a trim level into the Model field. 

              I am providing an array of messy car sales records in JSON format.
              The Make, Model, Trim, and Year fields are often mixed up (e.g., Year is inside the Make, Trim is inside the Model). 
              Standardize them using the rules above. 
              Extract the true Year, Make, Model, and Trim into separate fields. 
              Standardize the 'dealer' field to Title Case. 
              CRITICAL: You MUST retain and return the exact original "id" for every single record in the JSON array. If the "id" is missing, the database update will fail.
              Return the highly structured and corrected array in JSON format.
              Only return the JSON array, no markdown formatting.
              
              Data:
              ${JSON.stringify(salesBatch)}`
            }
          ]
        }
      ]
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const cleanJson = jsonMatch ? jsonMatch[0] : text;
    
    return JSON.parse(cleanJson) as CarSale[];
  } catch (error) {
    console.error("Gemini data detox failed:", error);
    throw error;
  }
};

export const standardizeVehicleString = async (input: string): Promise<StandardizedCarData> => {
  if (!apiKey) {
    throw new Error("API Key is missing. Please set VITE_GEMINI_API_KEY in your .env file.");
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Extract vehicle and sales information from this text: "${input}". 
      
      Rules:
      1. If a year is not present, use "Unknown". 
      2. If trim is not present, use "Base".
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
            trim: { type: Type.STRING },
            year: { type: Type.STRING },
            price: { type: Type.NUMBER },
            currency: { type: Type.STRING, enum: ['NGN', 'USD', 'EUR', 'GBP'] },
            dealer: { type: Type.STRING },
            dateSold: { type: Type.STRING }
          },
          required: ["make", "model", "trim", "year"]
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
      trim: "Unknown",
      year: "Unknown"
    };
  }
};

export const generateMarketForecast = async (salesSummary: any): Promise<MarketForecast> => {
  console.log("API Key present:", !!import.meta.env.VITE_GEMINI_API_KEY);
  if (!apiKey) throw new Error("API Key is missing. Please set VITE_GEMINI_API_KEY in your .env file.");

  const prompt = `
    Analyze the following car sales data summary to forecast demand for the next quarter.
    Data Summary: ${JSON.stringify(salesSummary)}
    
    Context: 
    - Some data might be "External Data". This represents general market sales observed from other dealers, useful for Volume and Price demand analysis.
    - Data with "avgDaysToSell" > 0 represents your direct inventory performance.
    
    Identify trends in:
    1. Which models are selling the fastest (days on market) based on inventory data.
    2. Which models have the highest volume (combining internal and external data).
    
    Provide a concise prediction for what cars I should acquire to sell next.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
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
  } catch (error: any) {
    console.error("Forecast generation failed - API Error Details:", error?.message || error);
    throw error;
  }
};