# AutoData: Smart Vehicle Sales Intelligence

AutoData is a world-class vehicle sales database and market analytics platform designed for automotive traders and dealership managers. It combines the power of **Google Gemini AI** with high-performance data tracking to transform raw sales strings into structured, actionable intelligence.

## 🚀 Key Features

### 1. AI-Powered Data Normalization
*   **Smart Fill:** Utilizing `gemini-3-flash-preview`, AutoData extracts make, model, sub-model, year, price, and dealer information from unstructured natural language inputs (e.g., *"Just sold a clean 2021 RX350 Luxury for 45m to a client at Lekki"*).
*   **Sequence Parsing:** High-speed comma-separated entry for power users mass-importing lists.
*   **Intelligent Autocomplete:** Learns your inventory patterns to suggest makes, models, and sub-models as you type.

### 2. Advanced Market Analytics
*   **Dynamic Dashboard:** Visualizes sales trends, revenue growth, and unit volume using **Recharts**.
*   **Sales Velocity Tracking:** Automatically calculates "Days to Sell" to identify which models move the fastest.
*   **Leaderboards:** Track top-performing sales staff/dealers and high-demand vehicle models.
*   **AI Forecasting:** Generates strategic acquisition advice based on historical performance and market sentiment.

### 3. Financial Precision & Multi-Currency Logic
*   **Real-time Exchange Rates:** Integrates with live currency APIs to ensure pricing data is always accurate despite fluctuations in the Nigerian Naira (NGN).
*   **USD Source-of-Truth:** All financial records are stored with a USD base value to preserve data integrity over time, while maintaining NGN as the primary display currency.
*   **Flexible Exports:** Download your database in CSV format with the option to convert all values to NGN or USD on the fly.

### 4. Data Integrity & "External Mode"
*   **Market Recording Mode:** Distinguish between your own inventory performance and external dealer data.
*   **Velocity Filtering:** Records tagged as "External Data" contribute to volume and pricing charts but are excluded from your personal "Sales Velocity" metrics to avoid skewing performance data.
*   **Bulk Operations:** Clean up your database efficiently with multi-select and bulk-delete functionality.

## 🛠️ Technical Stack
*   **Frontend:** React 19, TypeScript, Tailwind CSS
*   **AI Engine:** Google Gemini SDK (`@google/genai`)
*   **Visualizations:** Recharts
*   **State & Storage:** LocalStorage with robust migration patterns for data consistency
*   **Icons:** Lucide React

## 📦 Data Architecture
AutoData treats data portability as a priority. The import/export engine is built to handle:
*   Automatic mapping of legacy records to the new currency architecture.
*   Merge logic that avoids duplicates while populating auxiliary databases (Saved Dealers, Sub-models).
*   Sanitized CSV quoting to handle complex vehicle descriptions and tags.

## 🛡️ Privacy & Security
AutoData operates entirely in-browser. Your sales data, dealer lists, and financial records stay on your device unless you explicitly choose to export them. 

---
*Developed by Caplimo — Precision Tools for the Modern Automotive Professional.*