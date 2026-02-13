export function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const str = Buffer.concat(chunks).toString();
      if (str.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        process.stdin.unref();
        resolve(str.split("\n")[0]);
      }
    };
    process.stdin.ref();
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
