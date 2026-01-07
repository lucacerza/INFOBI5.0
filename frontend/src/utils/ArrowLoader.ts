// Just a stub for ArrowLoader if needed
import { tableFromIPC } from "apache-arrow";

export const ArrowLoader = {
  load: async (buffer: ArrayBuffer) => {
    const table = tableFromIPC(buffer);
    return table.toArray().map(row => row.toJSON());
  }
};
