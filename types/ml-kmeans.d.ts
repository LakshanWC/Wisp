declare module "ml-kmeans" {
  export function kmeans(
    data: number[][],
    k: number,
    options?: Record<string, unknown>
  ): {
    clusters: number[]
    centroids: number[][]
    iterations: number
    converged: boolean
  }
}