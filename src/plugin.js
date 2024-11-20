'use strict'

const { join, extname, relative, basename, dirname } = require('path')
const { tmpdir } = require('os')
const { promisify } = require('util')
const zip = promisify(require('cross-zip').zip)
const pMap = require('p-map')
const { copyFile, mkdir, mkdtemp, rm, writeFile, unlink } =
  require('fs').promises
const PDFDocument = require('pdfkit')
const { createWriteStream } = require('fs')
const { shell } = require('electron')

class ArchivePlugin {
  constructor(options, context) {
    this.options = {
      ...ArchivePlugin.defaults,
      ...options
    }

    this.logger = context.logger
    this.dialog = context.dialog.save
  }

  *processPhotoPaths(data, root, images) {
    let files = {}
    for (let item of data['@graph']) {
      if (!item.photo) continue

      // Keep track of photo order within each item
      let photoIndex = 1
      for (let photo of item.photo) {
        if (photo.protocol !== 'file') continue

        let src = photo.path
        let ext = extname(src)
        // Create new filename with padded index and photo title
        let paddedIndex = String(photoIndex).padStart(2, '0')
        let photoTitle = photo.title || 'untitled'
        // Remove any characters that might cause issues in filenames
        photoTitle = photoTitle.replace(/[<>:"/\\|?*]/g, '_')
        let dst = `${paddedIndex}_${photoTitle}${ext}`

        if (dst in files && photo.checksum !== files[dst]) {
          // If there's a naming conflict, append the checksum
          dst = `${paddedIndex}_${photoTitle}_${photo.checksum}${ext}`
        }

        if (!(dst in files)) {
          files[dst] = photo.checksum
          yield {
            src,
            dst: join(root, images, dst)
          }
        }
        photo.path = join(images, dst)
        photoIndex++
      }
    }
  }

  async generatePDF(item, root) {
    const doc = new PDFDocument({ 
      autoFirstPage: false,
      font: 'Helvetica'
    })
    const pdfPath = join(root, `${item.title}.pdf`)
    const writeStream = createWriteStream(pdfPath)
    
    doc.pipe(writeStream)

    for (let photo of item.photo) {
      // Skip non-file photos
      if (photo.protocol !== 'file') continue
      
      // Get the destination path of this photo in the archive
      const photoPath = join(root, photo.path)
      
      // Add a new page for each photo
      doc.addPage()
      
      // Calculate dimensions to fit photo within page while maintaining aspect ratio
      const margin = 10 // Reduce margin to 10pt (about 3.5mm)
      const pageWidth = doc.page.width - (2 * margin)
      const pageHeight = doc.page.height - (2 * margin)
      const ratio = Math.min(
        pageWidth / photo.width,
        pageHeight / photo.height
      )
      const width = photo.width * ratio
      const height = photo.height * ratio
      
      // Center the image on the page
      const x = (doc.page.width - width) / 2
      const y = (doc.page.height - height) / 2
      
      doc.image(photoPath, x, y, { width, height })
    }

    doc.end()
    
    // Wait for PDF to finish writing
    return new Promise((resolve, reject) => {
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
    })
  }

  async export(data) {
    let { zipFile, filters, concurrency, images } = this.options

    // Get the first item's title to use as default filename
    const defaultTitle = data['@graph'][0]?.title || 'archive'
    const defaultZipFile = `${defaultTitle}.zip`

    if (!zipFile || this.options.prompt) {
      zipFile = await this.dialog({ 
        defaultPath: defaultZipFile,
        filters 
      })
    }

    if (!zipFile) return

    // Ensure zip file looks like a zip file!
    if (extname(zipFile) !== '.zip') {
      throw new Error(`not a zip file: ${zipFile}`)
    }

    let tmp = await mkdtemp(join(tmpdir(), 'tropy-archive-'))
    try {
      let root = join(tmp, this.options.root)

      // Sanity check that root is still in tmp!
      if (relative(root, tmp) !== '..') {
        throw new Error(`root "${root}" outside of tmp folder!`)
      }

      await mkdir(join(root, images), { recursive: true })

      // Copy photos first
      await pMap(
        this.processPhotoPaths(data, root, images),
        ({ src, dst }) => copyFile(src, dst),
        { concurrency }
      )

      // Generate PDFs for each item
      for (let item of data['@graph']) {
        if (!item.photo || item.photo.length === 0) continue
        await this.generatePDF(item, root)
      }

      // Write metadata JSON
      await writeFile(
        join(root, this.options.json),
        JSON.stringify(data, null, 2)
      )

      try {
        await unlink(zipFile)
      } catch (e) {
        // ignore
      }

      await zip(root, zipFile)

      // Wait for a moment to ensure all file handles are closed
      await new Promise(resolve => setTimeout(resolve, 100))

      // Open the directory and select the zip file
      await shell.showItemInFolder(zipFile)

    } finally {
      try {
        // Use rm with force and recursive options
        await rm(tmp, { 
          force: true, 
          recursive: true,
          maxRetries: 3,
          retryDelay: 100
        })
      } catch (e) {
        // Log the error but don't throw it
        this.logger.error('Failed to remove temporary directory:', e)
      }
    }
  }
}

ArchivePlugin.defaults = {
  concurrency: 64,
  filters: [
    {
      name: 'Zip Files',
      extensions: ['zip']
    }
  ],
  images: '.',
  json: 'items.json',
  prompt: false,
  root: 'tropy'
}

module.exports = ArchivePlugin
