const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";

export class EmbeddingClient {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = "voyage-3.5-lite") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embedDocument(text: string): Promise<Float32Array> {
    const results = await this.embed([text], "document");
    return results[0];
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const results = await this.embed([text], "query");
    return results[0];
  }

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    // Voyage supports up to 128 inputs per call
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 128) {
      const batch = texts.slice(i, i + 128);
      const batchResults = await this.embed(batch, "document");
      results.push(...batchResults);
    }
    return results;
  }

  private async embed(
    input: string[],
    inputType: "document" | "query"
  ): Promise<Float32Array[]> {
    const resp = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input,
        model: this.model,
        input_type: inputType,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Voyage API error (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as {
      data: { embedding: number[] }[];
    };

    return data.data.map((d) => new Float32Array(d.embedding));
  }
}
