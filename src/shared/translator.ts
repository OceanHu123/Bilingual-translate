export interface Translator {
  translate(texts: string[], targetLang: string): Promise<string[]>;
}

const MAX_BATCH_CHARS = 4500;
const JOIN_SEP = "\n\u2060\n";

async function googleTranslateOnce(
  text: string,
  targetLang: string,
): Promise<string> {
  if (!text.trim()) return text;

  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: targetLang,
    dt: "t",
    dj: "1",
  });

  const useGet = text.length < 1800;
  let response: Response;

  if (useGet) {
    params.set("q", text);
    response = await fetch(
      `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
    );
  } else {
    response = await fetch(
      `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ q: text }).toString(),
      },
    );
  }

  if (!response.ok) {
    throw new Error(`Translate HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  return parseGoogleResponse(data);
}

function parseGoogleResponse(data: unknown): string {
  if (data && typeof data === "object" && "sentences" in data) {
    const sentences = (data as { sentences?: Array<{ trans?: string }> })
      .sentences;
    if (Array.isArray(sentences)) {
      return sentences.map((s) => s.trans ?? "").join("");
    }
  }
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return (data[0] as unknown[])
      .map((row) => (Array.isArray(row) ? String(row[0] ?? "") : ""))
      .join("");
  }
  if (typeof data === "string") return data;
  throw new Error("Unexpected translate response");
}

async function translateJoined(
  texts: string[],
  targetLang: string,
): Promise<string[]> {
  if (texts.length === 1) {
    return [await googleTranslateOnce(texts[0], targetLang)];
  }

  const joined = texts.join(JOIN_SEP);
  const translated = await googleTranslateOnce(joined, targetLang);
  const parts = translated.split(JOIN_SEP);
  if (parts.length === texts.length) return parts;

  const alt = translated.split("\n\u2060\n");
  if (alt.length === texts.length) return alt;

  const results: string[] = [];
  for (const text of texts) {
    results.push(await googleTranslateOnce(text, targetLang));
  }
  return results;
}

export class GoogleGtxTranslator implements Translator {
  async translate(texts: string[], targetLang: string): Promise<string[]> {
    const output = new Array<string>(texts.length);
    let batch: { index: number; text: string }[] = [];
    let batchChars = 0;

    const flush = async () => {
      if (!batch.length) return;
      const translated = await translateJoined(
        batch.map((item) => item.text),
        targetLang,
      );
      batch.forEach((item, i) => {
        output[item.index] = translated[i] ?? item.text;
      });
      batch = [];
      batchChars = 0;
    };

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (text.length > MAX_BATCH_CHARS) {
        await flush();
        output[i] = await googleTranslateOnce(text, targetLang);
        continue;
      }
      if (batchChars + text.length > MAX_BATCH_CHARS) {
        await flush();
      }
      batch.push({ index: i, text });
      batchChars += text.length + JOIN_SEP.length;
    }

    await flush();
    return output;
  }
}

export const defaultTranslator: Translator = new GoogleGtxTranslator();
