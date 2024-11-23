'use strict'

const { join, extname } = require('path')
const PDFDocument = require('pdfkit')
const { createWriteStream } = require('fs')
const { shell } = require('electron')

class PDFOriginalPlugin {
  constructor(options, context) {
    this.options = {
      ...PDFOriginalPlugin.defaults,
      ...options
    }

    this.logger = context.logger
    this.dialog = context.dialog.save
  }

  async generatePDF(data, outputPath) {
    const doc = new PDFDocument({ 
      autoFirstPage: false,
      size: 'A4',  // Always A4
      font: 'Helvetica'
    })
    
    const writeStream = createWriteStream(outputPath)
    doc.pipe(writeStream)

    // Process all photos in the item
    for (let item of data['@graph']) {
      if (!item.photo) continue

      for (let photo of item.photo) {
        if (photo.protocol !== 'file') continue

        // Always add a portrait page
        doc.addPage({
          size: 'A4',
          layout: 'portrait'  // Always portrait
        })

        // Get original dimensions
        const originalWidth = photo.width
        const originalHeight = photo.height

        // Calculate available space with minimum printable margins
        const margin = 7.2 // 0.25 inches = ~6.35mm = 7.2 points
        const pageWidth = doc.page.width - (2 * margin)
        const pageHeight = doc.page.height - (2 * margin)

        // Calculate scale to fit while maintaining aspect ratio
        const scale = Math.min(
          pageWidth / originalWidth,
          pageHeight / originalHeight
        )

        // Calculate final dimensions
        const finalWidth = originalWidth * scale
        const finalHeight = originalHeight * scale

        // Center on page
        const x = (doc.page.width - finalWidth) / 2
        const y = (doc.page.height - finalHeight) / 2

        // Apply transformations
        doc.save()
        
        // Move to center of image position
        doc.translate(x + (finalWidth / 2), y + (finalHeight / 2))

        // Apply rotation based on EXIF orientation
        switch (photo.orientation) {
          case 3: // 180° rotation (upside down)
            doc.rotate(180)
            break
          case 6: // 90° clockwise
            doc.rotate(-90)  // Changed to negative to match EXIF standard
            break
          case 8: // 270° clockwise (90° counterclockwise)
            doc.rotate(90)   // Changed to match EXIF standard
            break
          case 1: // Normal orientation
          default:
            // No rotation needed
            break
        }

        // Draw image centered at current position
        doc.image(photo.path, -finalWidth/2, -finalHeight/2, {
          width: finalWidth,
          height: finalHeight
        })

        doc.restore()
      }
    }

    doc.end()
    
    return new Promise((resolve, reject) => {
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
    })
  }

  async export(data) {
    let { pdfFile, filters } = this.options

    // Get the first item's title to use as default filename
    const defaultTitle = data['@graph'][0]?.title || 'export'
    const defaultPdfFile = `${defaultTitle}.pdf`

    if (!pdfFile || this.options.prompt) {
      pdfFile = await this.dialog({ 
        defaultPath: defaultPdfFile,
        filters 
      })
    }

    if (!pdfFile) return

    // Ensure file has .pdf extension
    if (extname(pdfFile) !== '.pdf') {
      throw new Error(`not a pdf file: ${pdfFile}`)
    }

    // Generate the PDF
    await this.generatePDF(data, pdfFile)

    // Open the PDF file directly instead of showing in folder
    await shell.openPath(pdfFile)
  }
}

PDFOriginalPlugin.defaults = {
  filters: [
    {
      name: 'PDF Files',
      extensions: ['pdf']
    }
  ],
  prompt: false
}

module.exports = PDFOriginalPlugin






